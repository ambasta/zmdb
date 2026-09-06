import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diff, up } from '@zmdb/migrations';
import { createQueryCompiler, UnsupportedFeatureError } from '@zmdb/query-compiler';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { outboxPendingIndexDdl, outboxTableDdl } from '@zmdb/query-compiler/outbox';
import { singlestore, singlestoreDriver, singlestoreIntrospector, singlestoreMigrations } from '@zmdb/singlestore';
import mysql2 from 'mysql2/promise';

const fixtureRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromFixture = createRequire(import.meta.url);
const urlText = process.env.ZMDB_SINGLESTORE_URL;
if (urlText === undefined || urlText.length === 0) {
  throw new Error('ZMDB_SINGLESTORE_URL is required; packed SingleStore acceptance is fail-closed');
}

const url = new URL(urlText);
const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
if (database.length === 0) throw new Error('ZMDB_SINGLESTORE_URL must name a database');

const pool = mysql2.createPool({
  host: url.hostname,
  port: url.port.length === 0 ? 3306 : Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
  connectionLimit: 6,
});
const driver = singlestoreDriver(pool);
const compiler = createQueryCompiler(singlestore);

const accounts = 'zmdb_674_accounts';
const events = 'zmdb_674_events';
const searchDocs = 'zmdb_674_search_docs';
const ddlProbe = 'zmdb_674_ddl_probe';
const outbox = 'zmdb_outbox';
const ddlProbeCreateSql =
  'CREATE ROWSTORE TABLE `zmdb_674_ddl_probe` (`id` BIGINT NOT NULL PRIMARY KEY, SHARD KEY (`id`))';
const ledger = '_zmdb_migrations';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function execute(text, parameters = []) {
  return driver.execute({ text, parameters });
}

async function step(name, run) {
  await run();
  process.stdout.write(`ok - ${name}\n`);
}

function table(snapshot, name) {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`catalog snapshot has no table "${name}"`);
  return found;
}

function packageRoot(specifier) {
  const resolved =
    typeof import.meta.resolve === 'function'
      ? fileURLToPath(import.meta.resolve(specifier))
      : requireFromFixture.resolve(specifier);
  return dirname(dirname(resolved));
}

async function manifest(specifier) {
  return JSON.parse(await readFile(join(packageRoot(specifier), 'package.json'), 'utf8'));
}

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.isFile() && /\.(?:m?js|d\.ts|ts)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const accountCreate = {
  kind: 'create_table',
  table: accounts,
  columns: [
    { name: 'id', type: 'serial', nullable: false, primaryKey: true },
    { name: 'external_id', type: 'bigint', nullable: false, primaryKey: false },
    { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  tableOptions: { rowstore: true, shardKey: ['id'] },
};

const eventCreate = {
  kind: 'create_table',
  table: events,
  columns: [
    { name: 'tenant_id', type: 'bigint', nullable: false, primaryKey: true },
    { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
    { name: 'message', type: 'varchar', length: 255, nullable: false, primaryKey: false },
    { name: 'occurred_at', type: 'timestamp', nullable: false, primaryKey: false },
  ],
  primaryKey: ['tenant_id', 'id'],
  foreignKeys: [],
  tableOptions: { shardKey: ['tenant_id'], sortKey: ['id'] },
};

try {
  await execute(`DROP TABLE IF EXISTS \`${events}\``);
  await execute(`DROP TABLE IF EXISTS \`${accounts}\``);
  await execute(`DROP TABLE IF EXISTS \`${searchDocs}\``);
  await execute(`DROP TABLE IF EXISTS \`${ddlProbe}\``);
  await execute(`DROP TABLE IF EXISTS \`${outbox}\``);
  await execute(`DROP TABLE IF EXISTS \`${ledger}\``);

  await step('uses the official SingleStore server and child-bound driver', async () => {
    const rows = await execute('SELECT @@memsql_version AS memsql_version, VERSION() AS wire_version');
    assert(typeof rows[0]?.memsql_version === 'string', 'server did not expose @@memsql_version');
    assert(rows[0]?.wire_version === '5.7.32', 'server did not expose the expected MySQL protocol version');
    assert(driver.dialect === singlestore, 'driver is not bound to the SingleStore dialect object');
    assert(singlestore.family === 'mysql', 'SingleStore did not retain the MySQL family');
  });

  await step('refuses unsupported integrity and storage operations before execution', async () => {
    let foreignKeyRefused = false;
    try {
      singlestoreMigrations.emitUp({
        ...accountCreate,
        foreignKeys: [
          {
            name: 'accounts_parent_fkey',
            columns: ['id'],
            targetTable: 'parents',
            targetColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'restrict',
          },
        ],
      });
    } catch (error) {
      foreignKeyRefused =
        error instanceof UnsupportedFeatureError && error.dialect === 'singlestore' && error.feature === 'foreign keys';
    }
    assert(foreignKeyRefused, 'foreign keys reached server-facing DDL');

    let uniqueRefused = false;
    try {
      singlestoreMigrations.emitUp({
        kind: 'create_table',
        table: 'invalid_unique',
        columns: [
          { name: 'tenant_id', type: 'bigint', nullable: false, primaryKey: false },
          { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false, unique: true },
        ],
        primaryKey: [],
        foreignKeys: [],
        tableOptions: { shardKey: ['tenant_id'] },
      });
    } catch (error) {
      uniqueRefused =
        error instanceof UnsupportedFeatureError && error.feature === 'unique column "email" outside the shard key';
    }
    assert(uniqueRefused, 'incompatible unique index reached server-facing DDL');

    let unshardedUniqueRefused = false;
    try {
      singlestoreMigrations.emitUp({
        kind: 'create_table',
        table: 'invalid_rowstore_unique',
        columns: [
          { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false, unique: true },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        tableOptions: { rowstore: true },
      });
    } catch (error) {
      unshardedUniqueRefused =
        error instanceof UnsupportedFeatureError && error.feature === 'unique column "email" outside the shard key';
    }
    assert(unshardedUniqueRefused, 'unsharded rowstore unique column reached server-facing DDL');

    let rowstoreSortRefused = false;
    try {
      singlestoreMigrations.emitUp({
        kind: 'create_table',
        table: 'invalid_rowstore_sort',
        columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
        primaryKey: ['id'],
        foreignKeys: [],
        tableOptions: { rowstore: true, sortKey: ['id'] },
      });
    } catch (error) {
      rowstoreSortRefused =
        error instanceof UnsupportedFeatureError &&
        error.feature === 'sort key on rowstore table "invalid_rowstore_sort"';
    }
    assert(rowstoreSortRefused, 'rowstore sort key reached server-facing DDL');

    for (const method of ['btree', 'hash']) {
      let methodRefused = false;
      try {
        singlestoreMigrations.emitSchemaObject({
          kind: 'create_index',
          definition: {
            name: `invalid_${method}_index`,
            table: events,
            method,
            columns: ['message'],
          },
        });
      } catch (error) {
        methodRefused =
          error instanceof UnsupportedFeatureError &&
          error.feature === `index method ${method} without table-storage evidence`;
      }
      assert(methodRefused, `explicit ${method} index reached server-facing DDL`);
    }

    let checkRefused = false;
    try {
      singlestoreMigrations.emitSchemaObject({
        kind: 'check_constraint',
        table: events,
        name: 'invalid_message_check',
        expression: 'LENGTH(message) > 0',
      });
    } catch (error) {
      checkRefused =
        error instanceof UnsupportedFeatureError && error.feature === 'check constraint "invalid_message_check"';
    }
    assert(checkRefused, 'check constraint reached server-facing DDL');

    const before = {
      version: 1,
      extensions: [],
      tables: [
        {
          name: events,
          columns: eventCreate.columns,
          primaryKey: eventCreate.primaryKey,
          foreignKeys: [],
          tableOptions: eventCreate.tableOptions,
        },
      ],
    };
    let storageRefused = false;
    try {
      diff(
        before,
        {
          ...before,
          tables: [{ ...before.tables[0], tableOptions: { rowstore: true } }],
        },
        { dialect: singlestore },
      );
    } catch (error) {
      storageRefused = error instanceof UnsupportedFeatureError && error.feature === 'table options change';
    }
    assert(storageRefused, 'storage transition produced a silent or executable diff');
  });

  await step('applies rowstore and columnstore migrations through the public vertical', async () => {
    const generated = singlestoreMigrations.emitSchemaObject({
      kind: 'generated_column',
      definition: {
        name: 'message_key',
        type: 'VARCHAR(255)',
        expression: 'LOWER(message)',
        stored: true,
      },
    })[0];
    assert(generated !== undefined, 'generated-column DDL was absent');
    const index = singlestoreMigrations.emitSchemaObject({
      kind: 'create_index',
      definition: {
        name: 'zmdb_674_events_message_key_idx',
        table: events,
        columns: ['message_key'],
      },
    })[0];
    assert(index !== undefined, 'generated-column index DDL was absent');

    const migrations = [
      {
        version: 674001,
        name: 'create rowstore accounts',
        up: singlestoreMigrations.emitUp(accountCreate),
        down: `DROP TABLE \`${accounts}\``,
      },
      {
        version: 674002,
        name: 'create columnstore events',
        up: singlestoreMigrations.emitUp(eventCreate),
        down: `DROP TABLE \`${events}\``,
      },
      {
        version: 674003,
        name: 'add persisted event key',
        up: `ALTER TABLE \`${events}\` ADD COLUMN ${generated}`,
        down: `ALTER TABLE \`${events}\` DROP COLUMN \`message_key\``,
      },
      {
        version: 674004,
        name: 'index persisted event key',
        up: index,
        down: `DROP INDEX \`zmdb_674_events_message_key_idx\` ON \`${events}\``,
      },
    ];
    const warnings = [];
    const applied = await up(singlestoreMigrations.connection(driver), migrations, {
      onWarning: warning => warnings.push(warning),
    });
    assert(
      JSON.stringify(applied) === JSON.stringify(migrations.map(migration => migration.version)),
      'migrations did not apply',
    );
    assert(
      warnings.length === 1 && warnings[0].includes('does not support transactional DDL'),
      `non-transactional DDL warning changed: ${JSON.stringify(warnings)}`,
    );
    await execute(outboxTableDdl(singlestore));
    await execute(outboxPendingIndexDdl(singlestore));
    await execute(
      `CREATE TABLE \`${searchDocs}\` (` +
        '`id` BIGINT NOT NULL PRIMARY KEY, `body` TEXT NOT NULL, FULLTEXT (`body`), ' +
        'SHARD KEY (`id`), SORT KEY (`id`))',
    );
  });

  await step('runs CRUD and pinned rollback transactions through mysql2', async () => {
    const insertedAccount = await driver.executeResult(
      compiler
        .insertInto(accounts)
        .values({ external_id: '9007199254740993', email: 'snowman-☃@example.test' })
        .compile(),
    );
    assert(insertedAccount.kind === 'command', 'account INSERT did not return command metadata');
    const accountId = insertedAccount.insertId;
    const selectedAccount = await driver.execute(compiler.selectFrom(accounts).where('id', '=', accountId).compile());
    assert(selectedAccount[0]?.external_id === '9007199254740993', 'BIGINT lost precision');
    assert(selectedAccount[0]?.email === 'snowman-☃@example.test', 'utf8mb4 text did not round-trip');

    await driver
      .transaction(async transaction => {
        await transaction.execute(
          compiler
            .insertInto(events)
            .values({
              tenant_id: 7,
              id: 1,
              message: 'Rolled-Back',
              occurred_at: '2026-09-06 12:34:56.123456',
            })
            .compile(),
        );
        throw new Error('expected rollback');
      })
      .catch(error => {
        if (!(error instanceof Error) || error.message !== 'expected rollback') throw error;
      });
    const afterRollback = await driver.execute(compiler.selectFrom(events).where('tenant_id', '=', 7).compile());
    assert(afterRollback.length === 0, 'transaction rollback did not remove the event');

    await driver.execute(
      compiler
        .insertInto(events)
        .values({
          tenant_id: 7,
          id: 2,
          message: 'Mixed-Case',
          occurred_at: '2026-09-06 12:34:56.123456',
        })
        .compile(),
    );
    const generated = await execute(
      `SELECT message_key, occurred_at FROM \`${events}\` WHERE tenant_id = ? AND id = ?`,
      [7, 2],
    );
    assert(generated[0]?.message_key === 'mixed-case', 'persisted computed column did not round-trip');
    assert(generated[0]?.occurred_at === '2026-09-06 12:34:56.123456', 'DATETIME(6) lost fractional precision');
    await execute(`INSERT INTO \`${searchDocs}\` (\`id\`, \`body\`) VALUES (?, ?)`, [1, 'single store search']);
    const fullText = ftsSelectFrom(searchDocs, singlestore).whereMatch('body', 'single').compile();
    assert(
      fullText.text === `SELECT * FROM \`${searchDocs}\` WHERE MATCH(\`body\`) AGAINST(?)`,
      `SingleStore full-text SQL changed: ${fullText.text}`,
    );
    await driver.execute(fullText);
    await driver.execute(
      compiler.updateTable(events).set({ message: 'updated' }).where('tenant_id', '=', 7).where('id', '=', 2).compile(),
    );
    const updated = await execute(`SELECT message FROM \`${events}\` WHERE tenant_id = ? AND id = ?`, [7, 2]);
    assert(updated[0]?.message === 'updated', 'UPDATE did not round-trip');
    await driver.execute(compiler.deleteFrom(events).where('tenant_id', '=', 7).where('id', '=', 2).compile());
  });

  await step('round-trips SingleStore storage and distribution catalog metadata', async () => {
    const catalog = await singlestoreIntrospector.snapshot(driver, {
      schemas: [database],
      include: [accounts, events, ledger, outbox],
      exclude: [],
    });
    const accountTable = table(catalog, accounts);
    const eventTable = table(catalog, events);
    const ledgerTable = table(catalog, ledger);
    const outboxTable = table(catalog, outbox);
    assert(accountTable.tableOptions?.rowstore === true, 'rowstore storage did not round-trip');
    assert(accountTable.tableOptions?.shardKey?.join(',') === 'id', 'rowstore shard key did not round-trip');
    assert(eventTable.tableOptions?.rowstore === undefined, 'columnstore was reported as rowstore');
    assert(eventTable.tableOptions?.shardKey?.join(',') === 'tenant_id', 'columnstore shard key did not round-trip');
    assert(eventTable.tableOptions?.sortKey?.join(',') === 'id', 'columnstore sort key did not round-trip');
    assert(ledgerTable.tableOptions?.rowstore === true, 'migration ledger was not created explicitly as rowstore');
    assert(outboxTable.tableOptions?.rowstore === true, 'outbox table was not created explicitly as rowstore');
    assert(
      outboxTable.indexes.some(index => index.name === 'zmdb_outbox_pending'),
      'outbox pending index disappeared from the normalized catalog',
    );
    assert(
      eventTable.columns.some(
        column =>
          column.name === 'message_key' &&
          column.generated?.stored === true &&
          column.generated.expression.toLowerCase().includes('lower'),
      ),
      'generated-column catalog evidence did not round-trip',
    );
    assert(
      eventTable.columns.some(
        column => column.name === 'occurred_at' && column.type === 'timestamp' && column.catalogType === 'datetime(6)',
      ),
      'DATETIME(6) catalog evidence did not round-trip',
    );
    assert(
      !catalog.warnings.some(warning => warning.table === events && warning.column === 'occurred_at'),
      'exact SingleStore DATETIME(6) produced a drift warning',
    );
    assert(
      catalog.warnings.length === 0,
      `unexpected SingleStore catalog warnings: ${JSON.stringify(catalog.warnings)}`,
    );
    assert(
      eventTable.indexes.some(index => index.name === 'zmdb_674_events_message_key_idx'),
      'ordinary secondary index disappeared from the normalized catalog',
    );
    assert(
      eventTable.indexes.every(index => index.method !== 'shard' && index.method !== 'clustered columnstore'),
      'SingleStore physical shard/sort indexes leaked into logical indexes',
    );
  });

  await step('proves the advertised non-transactional DDL boundary on the real server', async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(ddlProbeCreateSql);
      await connection.rollback();
    } finally {
      connection.release();
    }
    const rows = await execute(
      'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [database, ddlProbe],
    );
    assert(Number(rows[0]?.count) === 1, 'SingleStore CREATE TABLE unexpectedly rolled back');
    assert(singlestore.capabilities.transactionalDdl === false, 'SingleStore advertised transactional DDL');
  });

  await step('packed child uses only the public MySQL family edge', async () => {
    const fixture = JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8'));
    const childManifest = await manifest('@zmdb/singlestore');
    const mysqlManifest = await manifest('@zmdb/mysql');
    const childFiles = await sourceFiles(packageRoot('@zmdb/singlestore'));
    const childSource = (await Promise.all(childFiles.map(path => readFile(path, 'utf8')))).join('\n');
    const fixtureChild = fixture.dependencies?.['@zmdb/singlestore'];
    const expectedParent =
      typeof fixtureChild === 'string' && fixtureChild.startsWith('file:') ? childManifest.version : 'workspace:^';

    assert(fixture.dependencies?.mysql2 === '3.24.3', 'consumer did not select mysql2');
    assert(
      childManifest.dependencies?.['@zmdb/mysql'] === expectedParent,
      '@zmdb/singlestore did not depend on the public MySQL parent',
    );
    assert(
      mysqlManifest.dependencies?.['@zmdb/singlestore'] === undefined,
      '@zmdb/mysql created a reverse SingleStore dependency',
    );
    assert(!/@zmdb\/mysql(?:\/src|\/[^'"]+)/.test(childSource), 'packed child imported a MySQL internal path');
    assert(childManifest.dependencies?.mysql2 === undefined, '@zmdb/singlestore made mysql2 a hard dependency');
    assert(childManifest.peerDependenciesMeta?.mysql2?.optional === true, 'child mysql2 peer is not optional');
  });

  console.log('packed consumer runs CRUD and migrations against SingleStore');
} finally {
  try {
    await execute(`DROP TABLE IF EXISTS \`${events}\``);
    await execute(`DROP TABLE IF EXISTS \`${accounts}\``);
    await execute(`DROP TABLE IF EXISTS \`${searchDocs}\``);
    await execute(`DROP TABLE IF EXISTS \`${ddlProbe}\``);
    await execute(`DROP TABLE IF EXISTS \`${outbox}\``);
    await execute(`DROP TABLE IF EXISTS \`${ledger}\``);
  } finally {
    await pool.end();
  }
}
