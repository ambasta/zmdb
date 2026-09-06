import { mysql, mysqlDriver, mysqlIntrospector } from '@zmdb/mysql';
import { up } from '@zmdb/query-compiler/migrations';
import mysql2 from 'mysql2/promise';

const urlText = process.env.ZMDB_MYSQL_URL;
if (urlText === undefined) throw new Error('ZMDB_MYSQL_URL is required');

const url = new URL(urlText);
const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
if (database.length === 0) throw new Error('ZMDB_MYSQL_URL must name a database');

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
  connectionLimit: 4,
});
const driver = mysqlDriver(pool);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function table(snapshot, name) {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`catalog snapshot has no table "${name}"`);
  return found;
}

async function execute(text, parameters = []) {
  return driver.execute({ text, parameters });
}

try {
  const environment = await execute(
    'SELECT @@character_set_server AS character_set_server, ' +
      '@@character_set_connection AS character_set_connection, ' +
      '@@collation_server AS collation_server, @@sql_mode AS sql_mode',
  );
  const settings = environment[0];
  invariant(settings !== undefined, 'MySQL returned no server settings');
  invariant(settings.character_set_server === 'utf8mb4', 'MySQL server character set is not utf8mb4');
  invariant(settings.character_set_connection === 'utf8mb4', 'mysql2 connection character set is not utf8mb4');
  invariant(
    typeof settings.collation_server === 'string' && settings.collation_server.startsWith('utf8mb4_'),
    'MySQL server collation is not utf8mb4',
  );
  invariant(
    typeof settings.sql_mode === 'string' &&
      (settings.sql_mode.includes('STRICT_ALL_TABLES') || settings.sql_mode.includes('STRICT_TRANS_TABLES')),
    'MySQL server SQL mode is not strict',
  );

  await execute('DROP TABLE IF EXISTS `zmdb_671_posts`');
  await execute('DROP TABLE IF EXISTS `zmdb_671_accounts`');
  await execute('DROP TABLE IF EXISTS `_zmdb_migrations`');

  const createAccounts = mysql.migrations.emitUp({
    kind: 'create_table',
    table: 'zmdb_671_accounts',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'external_id', type: 'bigint', nullable: false, primaryKey: false },
      { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false, unique: true },
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  });
  const createPosts = mysql.migrations.emitUp({
    kind: 'create_table',
    table: 'zmdb_671_posts',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'account_id', type: 'integer', nullable: false, primaryKey: false },
      { name: 'slug', type: 'varchar', length: 120, nullable: false, primaryKey: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  });
  const addForeignKey = mysql.migrations.emitUp({
    kind: 'add_foreign_key',
    table: 'zmdb_671_posts',
    fk: {
      name: 'zmdb_671_posts_account_fkey',
      columns: ['account_id'],
      targetTable: 'zmdb_671_accounts',
      targetColumns: ['id'],
      onDelete: 'cascade',
      onUpdate: 'restrict',
    },
  });
  const generated = mysql.migrations.emitSchemaObject({
    kind: 'generated_column',
    definition: {
      name: 'slug_key',
      type: 'VARCHAR(120)',
      expression: 'lower(`slug`)',
      stored: true,
    },
  });
  const generatedIndex = mysql.migrations.emitSchemaObject({
    kind: 'create_index',
    definition: {
      name: 'zmdb_671_posts_slug_key_idx',
      table: 'zmdb_671_posts',
      columns: ['slug_key'],
    },
  });
  const warnings = [];
  await up(
    mysql.migrations.connection(driver),
    [
      {
        version: 671001,
        name: 'create accounts',
        up: createAccounts,
        down: 'DROP TABLE `zmdb_671_accounts`',
      },
      {
        version: 671002,
        name: 'create posts',
        up: createPosts,
        down: 'DROP TABLE `zmdb_671_posts`',
      },
      {
        version: 671003,
        name: 'add posts account foreign key',
        up: addForeignKey,
        down:
          'ALTER TABLE `zmdb_671_posts` DROP FOREIGN KEY `zmdb_671_posts_account_fkey`; ' +
          'DROP INDEX `zmdb_671_posts_account_fkey_idx` ON `zmdb_671_posts`',
      },
      {
        version: 671004,
        name: 'add generated slug key',
        up: `ALTER TABLE \`zmdb_671_posts\` ADD COLUMN ${generated[0]}`,
        down: 'ALTER TABLE `zmdb_671_posts` DROP COLUMN `slug_key`',
      },
      {
        version: 671005,
        name: 'index generated slug key',
        up: generatedIndex[0],
        down: 'DROP INDEX `zmdb_671_posts_slug_key_idx` ON `zmdb_671_posts`',
      },
    ],
    { onWarning: warning => warnings.push(warning) },
  );
  invariant(warnings.length === 1, 'MySQL migration runner did not report its non-transactional DDL boundary');

  /*
   * The compiler-owned snapshots above are deliberately constructed through the
   * package API. Keep the literal shape here visible to the packed consumer rather
   * than importing source-only fixtures.
   */
  void mysql.migrations.validateSnapshot({
    version: 1,
    extensions: [],
    tables: [],
  });

  const accountInsert = await driver.executeResult({
    text: 'INSERT INTO `zmdb_671_accounts` (`external_id`, `email`) VALUES (?, ?)',
    parameters: ['9007199254740993', 'snowman-☃@example.test'],
  });
  invariant(accountInsert.kind === 'command', 'INSERT returned rows instead of command metadata');
  invariant(accountInsert.affectedRows === 1, 'INSERT affectedRows was not 1');
  invariant(Number(accountInsert.insertId) > 0, 'INSERT did not expose insertId');
  const accountId = Number(accountInsert.insertId);

  const bound = await execute('SELECT ? AS bound_value', ['bound-through-mysql2']);
  invariant(bound[0]?.bound_value === 'bound-through-mysql2', 'positional mysql2 binding changed the value');

  const accounts = await execute('SELECT `external_id`, `email` FROM `zmdb_671_accounts` WHERE `id` = ?', [accountId]);
  invariant(accounts[0]?.external_id === '9007199254740993', 'BIGINT lost precision');
  invariant(accounts[0]?.email === 'snowman-☃@example.test', 'utf8mb4 text did not round-trip');

  await driver
    .transaction(async transaction => {
      await transaction.execute({
        text: 'INSERT INTO `zmdb_671_posts` (`account_id`, `slug`) VALUES (?, ?)',
        parameters: [accountId, 'Rolled-Back'],
      });
      const inside = await transaction.execute({
        text: 'SELECT COUNT(*) AS count FROM `zmdb_671_posts`',
        parameters: [],
      });
      invariant(Number(inside[0]?.count) === 1, 'transaction query did not see its own insert');
      throw new Error('expected rollback');
    })
    .catch(error => {
      if (!(error instanceof Error) || error.message !== 'expected rollback') throw error;
    });
  const afterRollback = await execute('SELECT COUNT(*) AS count FROM `zmdb_671_posts`');
  invariant(Number(afterRollback[0]?.count) === 0, 'transaction rollback did not remove the insert');

  await execute('INSERT INTO `zmdb_671_posts` (`account_id`, `slug`) VALUES (?, ?)', [accountId, 'Mixed-Case']);
  const generatedRows = await execute('SELECT `slug_key` FROM `zmdb_671_posts`');
  invariant(generatedRows[0]?.slug_key === 'mixed-case', 'generated column did not round-trip');

  const snapshot = await mysqlIntrospector.snapshot(driver, { schemas: [database] });
  const accountsTable = table(snapshot, 'zmdb_671_accounts');
  const postsTable = table(snapshot, 'zmdb_671_posts');
  invariant(accountsTable.primaryKey.join(',') === 'id', 'account primary key did not round-trip');
  invariant(
    postsTable.indexes.some(index => index.name === 'zmdb_671_posts_account_fkey_idx'),
    'foreign-key support index did not round-trip',
  );
  invariant(
    postsTable.indexes.some(index => index.name === 'zmdb_671_posts_slug_key_idx'),
    'generated-column index did not round-trip',
  );
  invariant(
    postsTable.columns.some(
      column =>
        column.name === 'slug_key' &&
        column.generated?.stored === true &&
        column.generated.expression.toLowerCase().includes('lower'),
    ),
    'generated-column catalog evidence did not round-trip',
  );
  invariant(
    postsTable.foreignKeys.some(
      foreignKey =>
        foreignKey.name === 'zmdb_671_posts_account_fkey' &&
        foreignKey.onDelete === 'cascade' &&
        foreignKey.onUpdate === 'restrict',
    ),
    'foreign key and actions did not round-trip',
  );

  console.log('packed consumer runs against strict utf8mb4 MySQL');
} finally {
  try {
    await execute('DROP TABLE IF EXISTS `zmdb_671_posts`');
    await execute('DROP TABLE IF EXISTS `zmdb_671_accounts`');
    await execute('DROP TABLE IF EXISTS `_zmdb_migrations`');
  } finally {
    await pool.end();
  }
}
