import { createRequire } from 'node:module';

import { createQueryCompiler, quoteTable } from '@zmdb/query-compiler';
import { detectDrift } from '@zmdb/query-compiler/introspect';
import {
  down,
  driverMigrationConnection,
  up,
  type Migration,
  type SchemaSnapshot,
} from '@zmdb/query-compiler/migrations';
import type { ConnectionPool } from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mssql, mssqlDriver, mssqlIntrospector, type MssqlCatalogTableSnapshot } from './index.js';

interface MssqlModule {
  connect(connection: string): Promise<ConnectionPool>;
}

interface ReachableMssql {
  readonly kind: 'reachable';
  readonly pool: ConnectionPool;
  readonly version: string;
}

interface UnreachableMssql {
  readonly kind: 'unreachable';
  readonly message: string;
}

type MssqlProbe = ReachableMssql | UnreachableMssql;

const CONNECTION = process.env.ZMDB_MSSQL_URL;
const REQUIRED = process.env.ZMDB_MSSQL_REQUIRED === '1';
const requireFromHere = createRequire(import.meta.url);

function loadMssql(): MssqlModule | undefined {
  try {
    const candidate: unknown = requireFromHere('mssql');
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      'connect' in candidate &&
      typeof candidate.connect === 'function'
    ) {
      return candidate as MssqlModule;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function probeMssql(): Promise<MssqlProbe> {
  if (CONNECTION === undefined) {
    return {
      kind: 'unreachable',
      message: '[skip] @zmdb/mssql live acceptance: set ZMDB_MSSQL_URL to a reachable SQL Server',
    };
  }
  const client = loadMssql();
  if (client === undefined) {
    return {
      kind: 'unreachable',
      message: '[skip] @zmdb/mssql live acceptance: development dependency "mssql" is unavailable',
    };
  }

  let pool: ConnectionPool | undefined;
  try {
    pool = await client.connect(CONNECTION);
    const result = await pool
      .request()
      .query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS version");
    const version = result.recordset[0]?.['version'];
    if (typeof version !== 'string') throw new Error('SQL Server returned no product version');
    return { kind: 'reachable', pool, version };
  } catch {
    await pool?.close();
    return {
      kind: 'unreachable',
      message: '[skip] @zmdb/mssql live acceptance: ZMDB_MSSQL_URL is not reachable',
    };
  }
}

const probe = await probeMssql();
if (probe.kind === 'unreachable') process.stderr.write(`${probe.message}\n`);

it('reports @zmdb/mssql live acceptance availability', () => {
  if (probe.kind === 'unreachable') {
    if (REQUIRED) throw new Error(probe.message.replace('[skip] ', ''));
    expect(probe.message).toMatch(/^\[skip\] @zmdb\/mssql live acceptance:/);
    return;
  }
  expect(probe.version).toMatch(/^\d+\.\d+\./);
});

function reachable(): ReachableMssql {
  if (probe.kind === 'unreachable') {
    throw new Error(`the live SQL Server suite ran despite its gate: ${probe.message}`);
  }
  return probe;
}

function table(snapshot: { readonly tables: readonly MssqlCatalogTableSnapshot[] }, name: string) {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`SQL Server catalog snapshot has no table "${name}"`);
  return found;
}

describe.skipIf(probe.kind === 'unreachable')('@zmdb/mssql against real SQL Server (#672)', () => {
  const suffix = String(process.pid);
  const schema = `zmdb_issue_672_${suffix}`;
  const roundTripName = 'round_trip';
  const catalogName = 'catalog_features';
  const childName = 'catalog_children';
  const roundTrip = `${schema}.${roundTripName}`;
  const catalog = `${schema}.${catalogName}`;
  const child = `${schema}.${childName}`;
  const sequenceName = `${schema}.catalog_sequence`;
  const ledger = `${schema}._zmdb_migrations`;
  const q = (name: string) => quoteTable(mssql, name);
  const migration: Migration = {
    version: 20260905067201,
    name: 'create SQL Server acceptance schema',
    up: [
      mssql.migrations.emitUp({
        kind: 'create_table',
        table: roundTrip,
        columns: [
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          { name: 'guid', type: 'UNIQUEIDENTIFIER', nullable: false, primaryKey: false },
          { name: 'label', type: 'varchar', length: 64, nullable: false, primaryKey: false },
          { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
          { name: 'happened_at', type: 'timestamp', nullable: false, primaryKey: false },
          { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
      }),
      `ALTER TABLE ${q(roundTrip)} ADD CONSTRAINT [round_trip_active_default] DEFAULT ((1)) FOR [active]`,
      mssql.migrations.emitUp({
        kind: 'create_table',
        table: catalog,
        columns: [
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          { name: 'guid', type: 'UNIQUEIDENTIFIER', nullable: false, primaryKey: false },
          { name: 'label', type: 'varchar', length: 64, nullable: false, primaryKey: false },
          { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
          { name: 'happened_at', type: 'timestamp', nullable: false, primaryKey: false },
          { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
      }),
      `ALTER TABLE ${q(catalog)} ADD CONSTRAINT [catalog_active_default] DEFAULT ((1)) FOR [active]`,
      `ALTER TABLE ${q(catalog)} ADD ${
        mssql.migrations.emitSchemaObject({
          kind: 'generated_column',
          definition: {
            name: 'label_size',
            type: 'integer',
            expression: 'LEN([label])',
            stored: true,
          },
        })[0]
      }`,
      `CREATE INDEX [catalog_active_label] ON ${q(catalog)} ([label]) INCLUDE ([happened_at]) WHERE [active] = 1`,
      mssql.migrations.emitUp({
        kind: 'create_table',
        table: child,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'catalog_id', type: 'integer', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
      }),
      mssql.migrations.emitUp({
        kind: 'add_foreign_key',
        table: child,
        fk: {
          name: 'catalog_children_parent_fkey',
          columns: ['catalog_id'],
          targetTable: catalog,
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no action',
        },
      }),
      mssql.migrations.emitSchemaObject({
        kind: 'create_sequence',
        definition: {
          name: sequenceName,
          start: 10,
          increment: 5,
        },
      })[0] ?? '',
    ].join(';\n'),
    down: [
      `DROP TABLE ${q(child)}`,
      `DROP TABLE ${q(catalog)}`,
      `DROP TABLE ${q(roundTrip)}`,
      `DROP SEQUENCE ${q(sequenceName)}`,
    ].join(';\n'),
  };

  beforeAll(async () => {
    const { pool } = reachable();
    await pool.request().query(`CREATE SCHEMA ${quoteTable(mssql, schema)}`);
    const driver = mssqlDriver(pool);
    await up(driverMigrationConnection(driver, mssql, { schema }), [migration]);
  });

  afterAll(async () => {
    const { pool } = reachable();
    try {
      await pool.request().query(`DROP TABLE IF EXISTS ${q(child)}`);
      await pool.request().query(`DROP TABLE IF EXISTS ${q(catalog)}`);
      await pool.request().query(`DROP TABLE IF EXISTS ${q(roundTrip)}`);
      await pool.request().query(`DROP TABLE IF EXISTS ${q(ledger)}`);
      await pool.request().query(`DROP SEQUENCE IF EXISTS ${q(sequenceName)}`);
      await pool.request().query(`DROP SCHEMA IF EXISTS ${quoteTable(mssql, schema)}`);
    } finally {
      await pool.close();
    }
  });

  it('round-trips DATETIMEOFFSET BIT UNIQUEIDENTIFIER and NVARCHAR', async () => {
    const driver = mssqlDriver(reachable().pool);
    const compiler = createQueryCompiler(mssql);
    const guid = '550e8400-e29b-41d4-a716-446655440000';
    const happenedAt = new Date('2026-09-05T12:34:56.789Z');

    const inserted = await driver.execute(
      compiler
        .insertInto(roundTrip)
        .values({
          guid,
          label: '東京 Δ',
          active: true,
          happened_at: happenedAt,
          visits: 1,
        })
        .returning(['id', 'guid', 'label', 'active', 'happened_at'])
        .compile(),
    );
    expect(inserted[0]).toMatchObject({
      label: '東京 Δ',
      active: true,
    });
    expect(String(inserted[0]?.['guid']).toLowerCase()).toBe(guid);
    const storedTimestamp = inserted[0]?.['happened_at'];
    expect(storedTimestamp).toBeInstanceOf(Date);
    if (!(storedTimestamp instanceof Date)) throw new TypeError('SQL Server returned no Date');
    expect(storedTimestamp.toISOString()).toBe(happenedAt.toISOString());

    const merged = await driver.execute(
      compiler
        .insertInto(roundTrip)
        .values({
          guid,
          label: '更新済み',
          active: false,
          happened_at: happenedAt,
          visits: 2,
        })
        .onConflict('guid')
        .doUpdate(['label', 'active', 'happened_at', 'visits'])
        .returning(['label', 'active', 'visits'])
        .compile(),
    );
    expect(merged).toEqual([{ label: '更新済み', active: false, visits: 2 }]);

    await driver.execute(
      compiler
        .insertInto(roundTrip)
        .values({
          guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
          label: 'second',
          active: true,
          happened_at: happenedAt,
          visits: 1,
        })
        .compile(),
    );
    const page = await driver.execute(compiler.selectFrom(roundTrip).orderBy('id', 'asc').offset(1).limit(1).compile());
    expect(page).toHaveLength(1);
    expect(page[0]?.['label']).toBe('second');

    const updated = await driver.execute(
      compiler.updateTable(roundTrip).set({ visits: 3 }).where('guid', '=', guid).returning(['visits']).compile(),
    );
    expect(updated).toEqual([{ visits: 3 }]);
    const deleted = await driver.execute(
      compiler
        .deleteFrom(roundTrip)
        .where('guid', '=', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')
        .returning(['label'])
        .compile(),
    );
    expect(deleted).toEqual([{ label: 'second' }]);
  });

  it('pins live requests to one node-mssql transaction', async () => {
    const driver = mssqlDriver(reachable().pool);
    const compiler = createQueryCompiler(mssql);
    const guid = '21ec2020-3aea-4069-a2dd-08002b30309d';

    await expect(
      driver.transaction(async transaction => {
        await transaction.execute(
          compiler
            .insertInto(roundTrip)
            .values({
              guid,
              label: 'rollback',
              active: true,
              happened_at: new Date('2026-09-05T00:00:00.000Z'),
              visits: 1,
            })
            .compile(),
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    await expect(driver.execute(compiler.selectFrom(roundTrip).where('guid', '=', guid).compile())).resolves.toEqual(
      [],
    );
  });

  it('applies and rolls back schema-qualified migrations through the package connection', async () => {
    const driver = mssqlDriver(reachable().pool);
    const connection = driverMigrationConnection(driver, mssql, { schema });
    const scratch: Migration = {
      version: 20260905067202,
      name: 'add scratch column',
      up: mssql.migrations.emitUp({
        kind: 'add_column',
        table: roundTrip,
        column: { name: 'scratch', type: 'bigint', nullable: true, primaryKey: false },
      }),
      down: mssql.migrations.emitDown({
        kind: 'add_column',
        table: roundTrip,
        column: { name: 'scratch', type: 'bigint', nullable: true, primaryKey: false },
      }),
    };

    await expect(up(connection, [migration, scratch])).resolves.toEqual([scratch.version]);
    await expect(down(connection, [migration, scratch])).resolves.toBe(scratch.version);
    const rows = await reachable()
      .pool.request()
      .input('schema', schema)
      .input('table', roundTripName)
      .query(
        'SELECT c.name FROM sys.columns c ' +
          'JOIN sys.tables t ON t.object_id = c.object_id ' +
          'JOIN sys.schemas s ON s.schema_id = t.schema_id ' +
          "WHERE s.name = @schema AND t.name = @table AND c.name = N'scratch'",
      );
    expect(rows.recordset).toEqual([]);
  });

  it('reads columns identity keys indexes and foreign keys', async () => {
    const snapshot = await mssqlIntrospector.snapshot(mssqlDriver(reachable().pool), {
      schemas: [schema],
    });
    const catalogTable = table(snapshot, catalogName);
    const childTable = table(snapshot, childName);

    expect(catalogTable.primaryKey).toEqual(['id']);
    expect(catalogTable.columns.find(column => column.name === 'id')).toMatchObject({
      type: 'serial',
      catalogType: 'INT',
      identity: { seed: '1', increment: '1' },
      primaryKey: true,
    });
    expect(catalogTable.columns.find(column => column.name === 'active')).toMatchObject({
      type: 'boolean',
      catalogType: 'BIT',
      default: '((1))',
    });
    expect(catalogTable.columns.find(column => column.name === 'guid')).toMatchObject({
      type: 'UNIQUEIDENTIFIER',
      catalogType: 'UNIQUEIDENTIFIER',
    });
    expect(catalogTable.columns.find(column => column.name === 'label')).toMatchObject({
      type: 'varchar',
      catalogType: 'NVARCHAR(64)',
      length: 64,
    });
    expect(catalogTable.columns.find(column => column.name === 'happened_at')).toMatchObject({
      type: 'timestamp',
      catalogType: 'DATETIMEOFFSET(3)',
    });
    expect(catalogTable.columns.find(column => column.name === 'label_size')).toMatchObject({
      type: 'integer',
      computed: {
        expression: '(len([label]))',
        persisted: true,
      },
    });
    expect(catalogTable.indexes).toEqual([
      {
        name: 'catalog_active_label',
        columns: ['label'],
        unique: false,
        where: '([active]=(1))',
        clustered: false,
        includedColumns: ['happened_at'],
        disabled: false,
      },
    ]);
    expect(childTable.foreignKeys).toEqual([
      {
        name: 'catalog_children_parent_fkey',
        columns: ['catalog_id'],
        targetTable: catalogName,
        targetColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no action',
        disabled: false,
        trusted: true,
      },
    ]);
    expect(snapshot.sequences).toEqual([
      {
        name: 'catalog_sequence',
        schema,
        catalogType: 'BIGINT',
        start: '10',
        increment: '5',
      },
    ]);
    expect(snapshot.warnings).toContainEqual({
      table: catalogName,
      reason:
        'SQL Server index "catalog_active_label" includes happened_at; ' +
        'included columns are preserved as catalog evidence but not emitted by the current DDL vocabulary',
    });
  });

  it('normalizes a migrated SQL Server table to a clean drift report', async () => {
    const snapshot = await mssqlIntrospector.snapshot(mssqlDriver(reachable().pool), {
      schemas: [schema],
      include: [roundTripName],
    });
    const live = mssqlIntrospector.normalizeForDrift(snapshot, 'live');
    const declared: SchemaSnapshot = {
      version: 1,
      tables: [
        {
          name: roundTripName,
          columns: [
            { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
            { name: 'guid', type: 'UNIQUEIDENTIFIER', nullable: false, primaryKey: false },
            { name: 'happened_at', type: 'timestamp', nullable: false, primaryKey: false },
            { name: 'id', type: 'serial', nullable: false, primaryKey: true },
            { name: 'label', type: 'varchar', length: 64, nullable: false, primaryKey: false },
            { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
        },
      ],
      extensions: [],
    };

    expect(detectDrift(live, declared)).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });
});
