import { createRequire } from 'node:module';

import { createQueryCompiler, quoteIdentifier } from '@zmdb/query-compiler';
import { emitUp, type ChangeOp } from '@zmdb/query-compiler/migrations';
import {
  createIndexDdl,
  createSchemaDdl,
  createSequenceDdl,
  generatedColumnDdl,
} from '@zmdb/query-compiler/schema-objects';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mssqlDriver, type MssqlPool } from './drivers/mssql.js';

interface LiveMssqlPool extends MssqlPool {
  close(): Promise<void>;
}

interface MssqlModule {
  connect(connection: string): Promise<LiveMssqlPool>;
}

interface ReachableMssql {
  readonly kind: 'reachable';
  readonly pool: LiveMssqlPool;
  readonly version: string;
}

interface UnreachableMssql {
  readonly kind: 'unreachable';
  readonly message: string;
}

type MssqlProbe = ReachableMssql | UnreachableMssql;

const CONNECTION = process.env.ZMDB_MSSQL_URL;
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
    return undefined;
  } catch {
    return undefined;
  }
}

async function probeMssql(): Promise<MssqlProbe> {
  if (CONNECTION === undefined) {
    return {
      kind: 'unreachable',
      message: '[skip] SQL Server E2E: set ZMDB_MSSQL_URL to a reachable SQL Server',
    };
  }

  const sql = loadMssql();
  if (sql === undefined) {
    return {
      kind: 'unreachable',
      message: '[skip] SQL Server E2E: repository test dependency "mssql" is unavailable',
    };
  }

  let pool: LiveMssqlPool | undefined;
  try {
    pool = await sql.connect(CONNECTION);
    const result = await pool
      .request()
      .query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS version");
    const version = result.recordset?.[0]?.['version'];
    if (typeof version !== 'string') throw new Error('SQL Server returned no product version');
    return { kind: 'reachable', pool, version };
  } catch {
    await pool?.close();
    return {
      kind: 'unreachable',
      message: `[skip] SQL Server E2E: no server reachable through ZMDB_MSSQL_URL`,
    };
  }
}

const mssql = await probeMssql();

if (mssql.kind === 'unreachable') {
  process.stderr.write(`${mssql.message}\n`);
}

it('reports SQL Server E2E availability instead of silently omitting the suite', () => {
  if (mssql.kind === 'unreachable') {
    console.warn(mssql.message);
    expect(mssql.message).toMatch(/^\[skip\] SQL Server E2E:/);
    return;
  }
  expect(mssql.version).toMatch(/^\d+\.\d+\./);
});

function reachableMssql(): ReachableMssql {
  if (mssql.kind === 'unreachable') {
    throw new Error(`the SQL Server suite ran despite its gate: ${mssql.message}`);
  }
  return mssql;
}

describe.skipIf(mssql.kind === 'unreachable')('repository against reachable real SQL Server (#508)', () => {
  const table = `zmdb_mssql_508_${String(process.pid)}]edge`;
  const index = `zmdb_mssql_508_${String(process.pid)}_email`;

  beforeAll(async () => {
    const live = reachableMssql();
    const create: ChangeOp = {
      kind: 'create_table',
      table,
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false },
        { name: 'role', type: 'varchar', length: 32, nullable: false, primaryKey: false },
        { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
        { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
        { name: 'at', type: 'timestamp', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    await live.pool.request().query(emitUp(create, 'mssql'));
    await live.pool.request().query(createIndexDdl({ name: index, table, columns: ['email'], unique: true }, 'mssql'));
  });

  afterAll(async () => {
    const live = reachableMssql();
    try {
      await live.pool.request().query(`DROP TABLE ${quoteIdentifier('mssql', table)}`);
    } finally {
      await live.pool.close();
    }
  });

  it('round-trips named parameters, bracket quoting, OUTPUT, pagination and HOLDLOCK MERGE', async () => {
    const live = reachableMssql();
    const driver = mssqlDriver(live.pool);
    const compiler = createQueryCompiler('mssql');
    const at = new Date('2026-09-04T12:30:00.000Z');

    const inserted = await driver.execute(
      compiler
        .insertInto(table)
        .values({ email: 'a@b.com', role: 'user', visits: 1, active: true, at })
        .returning(['id', 'email'])
        .compile(),
    );
    expect(inserted[0]?.['email']).toBe('a@b.com');
    const storedTimestamp = await driver.execute(
      compiler.selectFrom(table).select(['at']).where('email', '=', 'a@b.com').compile(),
    );
    const storedAt = storedTimestamp[0]?.['at'];
    expect(storedAt).toBeInstanceOf(Date);
    if (!(storedAt instanceof Date)) throw new TypeError('SQL Server timestamp did not round-trip as a Date');
    expect(storedAt.toISOString()).toBe(at.toISOString());

    const merged = await driver.execute(
      compiler
        .insertInto(table)
        .values({ email: 'a@b.com', role: 'admin', visits: 2, active: false, at })
        .onConflict('email')
        .doUpdate(['role', 'visits', 'active', 'at'])
        .returning(['id', 'role', 'visits'])
        .compile(),
    );
    expect(merged[0]).toMatchObject({ role: 'admin', visits: 2 });

    await driver.execute(
      compiler.insertInto(table).values({ email: 'b@c.com', role: 'user', visits: 1, active: true, at }).compile(),
    );
    const page = await driver.execute(compiler.selectFrom(table).orderBy('id', 'asc').offset(1).limit(1).compile());
    expect(page).toHaveLength(1);
    expect(page[0]?.['email']).toBe('b@c.com');

    const updated = await driver.execute(
      compiler.updateTable(table).set({ role: 'owner' }).where('email', '=', 'a@b.com').returning(['role']).compile(),
    );
    expect(updated).toEqual([{ role: 'owner' }]);

    const deleted = await driver.execute(
      compiler.deleteFrom(table).where('email', '=', 'b@c.com').returning(['email']).compile(),
    );
    expect(deleted).toEqual([{ email: 'b@c.com' }]);
  });

  it('rolls back every request created inside one node-mssql transaction', async () => {
    const live = reachableMssql();
    const driver = mssqlDriver(live.pool);
    const compiler = createQueryCompiler('mssql');
    const email = `rollback-${String(process.pid)}@example.com`;
    const at = new Date('2026-09-05T00:00:00.000Z');

    await expect(
      driver.transaction(async transaction => {
        await transaction.execute(
          compiler.insertInto(table).values({ email, role: 'probe', visits: 1, active: true, at }).compile(),
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    await expect(
      driver.execute(compiler.selectFrom(table).select(['email']).where('email', '=', email).compile()),
    ).resolves.toEqual([]);
  });

  it('executes generated SQL Server add, alter and drop column migrations without losing nullability', async () => {
    const live = reachableMssql();
    await live.pool.request().query(
      emitUp(
        {
          kind: 'add_column',
          table,
          column: { name: 'scratch', type: 'integer', nullable: true, primaryKey: false },
        },
        'mssql',
      ),
    );
    await live.pool.request().query(
      emitUp(
        {
          kind: 'alter_column_type',
          table,
          column: 'scratch',
          from: 'integer',
          to: 'bigint',
          fromNullable: true,
          toNullable: true,
        },
        'mssql',
      ),
    );
    await live.pool.request().query(
      emitUp(
        {
          kind: 'alter_column_type',
          table,
          column: 'role',
          from: 'varchar',
          to: 'text',
          fromNullable: false,
          toNullable: false,
        },
        'mssql',
      ),
    );
    const columns = await live.pool
      .request()
      .input('table', table)
      .query(
        'SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS ' +
          "WHERE TABLE_NAME = @table AND COLUMN_NAME IN ('role', 'scratch') ORDER BY COLUMN_NAME",
      );
    expect(columns.recordset).toEqual([
      { name: 'role', nullable: 'NO' },
      { name: 'scratch', nullable: 'YES' },
    ]);
    await live.pool.request().query(emitUp({ kind: 'drop_column', table, column: 'scratch' }, 'mssql'));
  });

  it('executes SQL Server schemas, keys, filtered indexes, sequences and persisted computed columns', async () => {
    const live = reachableMssql();
    const suffix = String(process.pid);
    const schema = `zmdb_508_schema_${suffix}`;
    const sequence = `zmdb_508_sequence_${suffix}`;
    const parent = `zmdb_508_parent_${suffix}`;
    const child = `zmdb_508_child_${suffix}`;
    const filtered = `zmdb_508_filtered_${suffix}`;
    const foreignKey = `zmdb_508_fk_${suffix}`;
    const q = (name: string) => quoteIdentifier('mssql', name);
    let schemaCreated = false;
    let sequenceCreated = false;
    let parentCreated = false;
    let childCreated = false;

    try {
      await live.pool.request().query(createSchemaDdl(schema, 'mssql'));
      schemaCreated = true;
      await live.pool.request().query(createSequenceDdl({ name: sequence, start: 10, increment: 5 }, 'mssql'));
      sequenceCreated = true;
      await live.pool.request().query(
        emitUp(
          {
            kind: 'create_table',
            table: parent,
            columns: [
              { name: 'id', type: 'integer', nullable: false, primaryKey: true },
              { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
              { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
            ],
            primaryKey: ['id'],
            foreignKeys: [],
          },
          'mssql',
        ),
      );
      parentCreated = true;
      await live.pool
        .request()
        .query(
          `ALTER TABLE ${q(parent)} ADD ` +
            generatedColumnDdl(
              { name: 'double_visits', type: 'integer', expression: '[visits] * 2', stored: true },
              'mssql',
            ),
        );
      await live.pool
        .request()
        .query(createIndexDdl({ name: filtered, table: parent, columns: ['id'], where: '[active] = 1' }, 'mssql'));
      await live.pool.request().query(
        emitUp(
          {
            kind: 'create_table',
            table: child,
            columns: [
              { name: 'id', type: 'integer', nullable: false, primaryKey: true },
              { name: 'parent_id', type: 'integer', nullable: false, primaryKey: false },
            ],
            primaryKey: ['id'],
            foreignKeys: [],
          },
          'mssql',
        ),
      );
      childCreated = true;
      await live.pool.request().query(
        emitUp(
          {
            kind: 'add_foreign_key',
            table: child,
            fk: {
              name: foreignKey,
              columns: ['parent_id'],
              targetTable: parent,
              targetColumns: ['id'],
              onDelete: 'restrict',
              onUpdate: 'cascade',
            },
          },
          'mssql',
        ),
      );

      await live.pool.request().query(`INSERT INTO ${q(parent)} ([id], [active], [visits]) VALUES (1, 1, 3)`);
      const computed = await live.pool
        .request()
        .query(`SELECT [double_visits] AS value FROM ${q(parent)} WHERE [id] = 1`);
      const next = await live.pool.request().query(`SELECT NEXT VALUE FOR ${q(sequence)} AS value`);
      expect(computed.recordset).toEqual([{ value: 6 }]);
      expect(next.recordset?.[0]?.['value']).toBe('10');
    } finally {
      if (childCreated) await live.pool.request().query(`DROP TABLE ${q(child)}`);
      if (parentCreated) await live.pool.request().query(`DROP TABLE ${q(parent)}`);
      if (sequenceCreated) await live.pool.request().query(`DROP SEQUENCE ${q(sequence)}`);
      if (schemaCreated) await live.pool.request().query(`DROP SCHEMA ${q(schema)}`);
    }
  });
});
