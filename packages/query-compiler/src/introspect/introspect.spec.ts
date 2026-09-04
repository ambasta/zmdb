import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import type { CompiledQuery, Dialect } from '../index.js';
import {
  diff,
  emitUp,
  snapshot,
  type ChangeOp,
  type ColumnSnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
} from '../migrations/index.js';
import { CatalogRowError, createIntrospector } from './index.js';

// Introspection tests freeze for #430. The SQLite rows below come from a real
// node:sqlite DatabaseSync. The MySQL rows are the byte-for-byte textual capture in
// __fixtures__/mysql-8.4.11.json; its provenance test is green today. The missing
// reader/emitter/drift surfaces are resolved dynamically so each behavioral test
// occupies Vitest's expected-failure bucket instead of failing this file at link time.

export interface RoundTripUser extends Table<'round_trip_users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  display_name: string & Sql<'text'>;
  nickname: (string & Sql<'text'>) | null;
}

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const { RoundTripUser: RoundTripUserSchema } = schemasFrom<{ RoundTripUser: RoundTripUser }>(
  import.meta.url,
  ['RoundTripUser'],
  { project: join(ROOT, 'packages/query-compiler/tsconfig.json') },
);

type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
type FrozenIndexColumn = string | { readonly expr: string; readonly opclass?: string };

interface FrozenForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

interface FrozenIndexSnapshot {
  readonly name: string;
  readonly columns: readonly FrozenIndexColumn[];
  readonly unique: boolean;
  readonly method?: string;
  readonly where?: string;
}

type FrozenColumnSnapshot = ColumnSnapshot & {
  readonly catalogType?: string;
  readonly default?: string;
};

type FrozenTableSnapshot = Omit<TableSnapshot, 'columns'> & {
  readonly columns: readonly FrozenColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly FrozenForeignKeySnapshot[];
  readonly indexes: readonly FrozenIndexSnapshot[];
};

type FrozenSchemaSnapshot = Omit<SchemaSnapshot, 'tables'> & {
  readonly tables: readonly FrozenTableSnapshot[];
  readonly extensions: readonly { readonly name: string; readonly schema?: string }[];
};

interface FrozenDriver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

interface FrozenIntrospectOptions {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

interface FrozenIntrospector {
  readonly dialect: Dialect;
  snapshot(driver: FrozenDriver, options?: FrozenIntrospectOptions): Promise<FrozenSchemaSnapshot>;
}

interface FrozenEmitOptions {
  readonly dialect: Dialect;
}

interface FrozenEmitDeclarationsResult {
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly warnings: readonly {
    readonly table: string;
    readonly column?: string;
    readonly reason: string;
  }[];
}

type FrozenEmitDeclarations = (
  snapshot: FrozenSchemaSnapshot,
  options: FrozenEmitOptions,
) => FrozenEmitDeclarationsResult | Promise<FrozenEmitDeclarationsResult>;

interface FrozenDriftReport {
  readonly onlyInDatabase: readonly ChangeOp[];
  readonly onlyInDeclarations: readonly ChangeOp[];
  readonly clean: boolean;
}

type FrozenDetectDrift = (
  live: FrozenSchemaSnapshot,
  declared: FrozenSchemaSnapshot,
  options?: { readonly exclude?: readonly string[] },
) => FrozenDriftReport;

async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('./index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/query-compiler exports no "${name}" (frozen: introspect/SPEC.md 1)`);
  }
  return value as T;
}

async function introspectorFor(dialect: Dialect): Promise<FrozenIntrospector> {
  return createIntrospector(dialect);
}

function bindable(value: unknown): null | number | bigint | string | Uint8Array {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error(`the SQLite catalog query tried to bind ${typeof value}`);
}

function plainRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(Object.entries(row)));
}

function sqliteDriver(database: DatabaseSync): FrozenDriver {
  return {
    async execute(query) {
      const rows = database.prepare(query.text).all(...query.parameters.map(bindable));
      return plainRows(rows);
    },
  };
}

function sqliteFixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      nickname TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memberships (
      tenant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, tenant_id)
    ) WITHOUT ROWID;
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      body TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE CASCADE ON UPDATE RESTRICT
    );
    CREATE UNIQUE INDEX posts_slug_uq ON posts(slug);
    CREATE INDEX posts_lower_slug_idx ON posts(lower(slug));
    CREATE TABLE _zmdb_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  return database;
}

function table(value: FrozenSchemaSnapshot, name: string): FrozenTableSnapshot {
  const found = value.tables.find(candidate => candidate.name === name);
  if (!found) throw new Error(`snapshot has no table "${name}"`);
  return found;
}

function column(value: FrozenSchemaSnapshot, tableName: string, name: string): FrozenColumnSnapshot {
  const found = table(value, tableName).columns.find(candidate => candidate.name === name);
  if (!found) throw new Error(`snapshot has no column "${tableName}.${name}"`);
  return found;
}

function emptySnapshot(tables: readonly FrozenTableSnapshot[] = []): FrozenSchemaSnapshot {
  return { version: 1, tables, extensions: [] };
}

function emptyTable(name: string, columns: readonly FrozenColumnSnapshot[] = []): FrozenTableSnapshot {
  return { name, columns, primaryKey: [], foreignKeys: [], indexes: [] };
}

function coreProjection(value: FrozenSchemaSnapshot | SchemaSnapshot): unknown {
  return {
    version: value.version,
    tables: value.tables.map(one => ({
      name: one.name,
      columns: one.columns.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        primaryKey: col.primaryKey,
        ...(col.length === undefined ? {} : { length: col.length }),
      })),
    })),
  };
}

interface MySqlCapture {
  readonly provenance: {
    readonly captureFormat: string;
    readonly imageDigest: string;
    readonly schema: string;
    readonly serverVersion: string;
  };
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`${where} is not a string`);
  return value;
}

function rowList(value: unknown, where: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${where} is not an array`);
  return value.map((row, index) => record(row, `${where}[${String(index)}]`));
}

function mysqlCapture(): MySqlCapture {
  const path = new URL('./__fixtures__/mysql-8.4.11.json', import.meta.url);
  const root = record(JSON.parse(readFileSync(path, 'utf8')), 'mysql capture');
  const provenance = record(root['provenance'], 'mysql capture.provenance');
  const server = record(provenance['server'], 'mysql capture.provenance.server');
  const rows = record(root['rows'], 'mysql capture.rows');

  return {
    provenance: {
      captureFormat: text(provenance['captureFormat'], 'captureFormat'),
      imageDigest: text(provenance['imageDigest'], 'imageDigest'),
      schema: text(provenance['schema'], 'schema'),
      serverVersion: text(server['version'], 'server.version'),
    },
    rows: Object.fromEntries(
      Object.entries(rows).map(([name, value]) => [name, rowList(value, `mysql capture.rows.${name}`)]),
    ),
  };
}

function mysqlFixtureDriver(capture: MySqlCapture): FrozenDriver {
  const catalogs: readonly [needle: string, rows: readonly Record<string, unknown>[]][] = [
    ['information_schema.referential_constraints', capture.rows['referentialConstraints'] ?? []],
    ['information_schema.key_column_usage', capture.rows['keyColumnUsage'] ?? []],
    ['information_schema.statistics', capture.rows['statistics'] ?? []],
    ['information_schema.columns', capture.rows['columns'] ?? []],
    ['information_schema.tables', capture.rows['tables'] ?? []],
  ];

  return {
    async execute(query) {
      if (!query.parameters.includes(capture.provenance.schema)) {
        throw new Error('the MySQL catalog query did not bind the requested schema');
      }
      const sql = query.text.toLowerCase();
      const match = catalogs.find(([needle]) => sql.includes(needle));
      if (!match) throw new Error(`unrecorded MySQL catalog query: ${query.text}`);
      return match[1].map(row => ({ ...row }));
    },
  };
}

describe('real node:sqlite catalog evidence', () => {
  it('captures the SQLite catalog rows used by the freeze', () => {
    const database = sqliteFixture();
    try {
      expect(plainRows(database.prepare("PRAGMA table_info('memberships')").all())).toEqual([
        { cid: 0, name: 'tenant_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 2 },
        { cid: 1, name: 'user_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 2, name: 'role', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      ]);
      expect(plainRows(database.prepare("PRAGMA foreign_key_list('posts')").all())).toEqual([
        {
          id: 0,
          seq: 0,
          table: 'accounts',
          from: 'account_id',
          to: 'id',
          on_update: 'RESTRICT',
          on_delete: 'CASCADE',
          match: 'NONE',
        },
      ]);
      expect(plainRows(database.prepare("PRAGMA index_info('posts_lower_slug_idx')").all())).toEqual([
        { seqno: 0, cid: -2, name: null },
      ]);
    } finally {
      database.close();
    }
  });

  it('reads tables, columns, nullability and primary keys from a real sqlite database', async () => {
    const database = sqliteFixture();
    try {
      const introspector = await introspectorFor('sqlite');
      const actual = await introspector.snapshot(sqliteDriver(database));

      expect(actual.tables.map(one => one.name)).toEqual(['accounts', 'memberships', 'posts']);
      expect(table(actual, 'accounts').columns).toEqual([
        {
          name: 'created_at',
          type: 'text',
          catalogType: 'TEXT',
          nullable: false,
          primaryKey: false,
          default: 'CURRENT_TIMESTAMP',
        },
        { name: 'email', type: 'text', catalogType: 'TEXT', nullable: false, primaryKey: false },
        { name: 'id', type: 'serial', catalogType: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'nickname', type: 'text', catalogType: 'TEXT', nullable: true, primaryKey: false },
        {
          name: 'status',
          type: 'text',
          catalogType: 'TEXT',
          nullable: false,
          primaryKey: false,
          default: "'active'",
        },
      ]);
      expect(table(actual, 'accounts').primaryKey).toEqual(['id']);
    } finally {
      database.close();
    }
  });

  // table_info.pk is a 1-based key ordinal: tenant_id reports 2 and user_id 1.
  it('reads a composite primary key in declaration order', async () => {
    const database = sqliteFixture();
    try {
      const actual = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      expect(table(actual, 'memberships').primaryKey).toEqual(['user_id', 'tenant_id']);
    } finally {
      database.close();
    }
  });

  // SQLite does not return a constraint name. The normalized snapshot uses the same
  // deterministic <table>_<column>_fkey name as the declaration path.
  it('reads foreign keys with their referential actions', async () => {
    const database = sqliteFixture();
    try {
      const actual = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      expect(table(actual, 'posts').foreignKeys).toEqual([
        {
          name: 'posts_account_id_fkey',
          columns: ['account_id'],
          targetTable: 'accounts',
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'restrict',
        },
      ]);
    } finally {
      database.close();
    }
  });

  // PRAGMA index_info identifies an expression as cid=-2/name=NULL; sqlite_master.sql
  // is therefore the measured fallback for lower(slug).
  it('reads indexes including a unique one and an expression one', async () => {
    const database = sqliteFixture();
    try {
      const actual = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      expect(table(actual, 'posts').indexes).toEqual([
        { name: 'posts_lower_slug_idx', columns: [{ expr: 'lower(slug)' }], unique: false },
        { name: 'posts_slug_uq', columns: ['slug'], unique: true },
      ]);
    } finally {
      database.close();
    }
  });

  // SQLite and the real MySQL capture are always available. The gated real-Postgres
  // arm lives in postgres.spec.ts and announces itself when the benchmark server is absent.
  it('recognises a serial column per dialect', async () => {
    const database = sqliteFixture();
    try {
      const sqlite = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      const capture = mysqlCapture();
      const mysql = await (
        await introspectorFor('mysql')
      ).snapshot(mysqlFixtureDriver(capture), {
        schemas: [capture.provenance.schema],
      });

      expect(column(sqlite, 'accounts', 'id').type).toBe('serial');
      expect(column(mysql, 'accounts', 'id').type).toBe('serial');
      expect(column(mysql, 'posts', 'id').type).toBe('serial');
    } finally {
      database.close();
    }
  });

  it('preserves a column default expression', async () => {
    const database = sqliteFixture();
    try {
      const actual = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      expect(column(actual, 'accounts', 'status').default).toBe("'active'");
      expect(column(actual, 'accounts', 'created_at').default).toBe('CURRENT_TIMESTAMP');
    } finally {
      database.close();
    }
  });
});

describe('captured real MySQL catalog rows', () => {
  it('records MySQL catalog rows with exact server provenance', () => {
    const capture = mysqlCapture();
    expect(capture.provenance).toEqual({
      captureFormat: 'mysql --batch --raw; every non-NULL catalog cell is retained as text',
      imageDigest: 'sha256:1d6b6a8fcee8ff758ff151d017f5203cd06792a0e698f0a593c9dfcb14609cf0',
      schema: 'zmdb430',
      serverVersion: '8.4.11',
    });
    expect(capture.rows['tables']).toHaveLength(3);
    expect(capture.rows['columns']).toHaveLength(14);
    expect(capture.rows['referentialConstraints']).toEqual([
      {
        TABLE_NAME: 'posts',
        CONSTRAINT_NAME: 'posts_account_fkey',
        UNIQUE_CONSTRAINT_NAME: 'PRIMARY',
        MATCH_OPTION: 'NONE',
        UPDATE_RULE: 'RESTRICT',
        DELETE_RULE: 'CASCADE',
      },
    ]);
  });

  it('reads MySQL catalog rows captured from a real server', async () => {
    const capture = mysqlCapture();
    const actual = await createIntrospector('mysql').snapshot(mysqlFixtureDriver(capture), {
      schemas: [capture.provenance.schema],
    });

    expect(actual.tables.map(one => one.name)).toEqual(['accounts', 'memberships', 'posts']);
    expect(table(actual, 'memberships').primaryKey).toEqual(['user_id', 'tenant_id']);
    expect(column(actual, 'accounts', 'active')).toMatchObject({
      type: 'boolean',
      catalogType: 'tinyint(1)',
      nullable: false,
      default: '1',
    });
    expect(column(actual, 'accounts', 'id')).toMatchObject({ type: 'serial', catalogType: 'bigint' });
    expect(column(actual, 'accounts', 'email')).toMatchObject({
      type: 'varchar',
      catalogType: 'varchar(255)',
      length: 255,
    });
    expect(column(actual, 'accounts', 'balance').type).toBe('numeric');
    expect(column(actual, 'accounts', 'status').type).toBe('jsonEnum');
    expect(column(actual, 'accounts', 'created_at').type).toBe('timestamp');
    expect(column(actual, 'posts', 'body')).toMatchObject({ type: 'text', catalogType: 'longtext' });
    expect(actual.warnings).toContainEqual({
      table: 'posts',
      column: 'body',
      reason: 'MySQL type longtext was widened to text',
    });
    expect(table(actual, 'posts').foreignKeys).toEqual([
      {
        name: 'posts_account_fkey',
        columns: ['account_id'],
        targetTable: 'accounts',
        targetColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'restrict',
      },
    ]);
  });
});

it('produces a snapshot that diffs cleanly against the declared snapshot for the same schema', async () => {
  const declared = snapshot([RoundTripUserSchema]);
  const declaredTable = declared.tables[0];
  if (!declaredTable) throw new Error('the RoundTripUser declaration produced no table');

  const database = new DatabaseSync(':memory:');
  try {
    database.exec(
      emitUp({ kind: 'create_table', table: declaredTable.name, columns: declaredTable.columns }, 'sqlite'),
    );
    const live = await createIntrospector('sqlite').snapshot(sqliteDriver(database));

    expect(coreProjection(live)).toEqual(coreProjection(declared));
    expect(diff(live, declared)).toEqual([]);
    expect(diff(declared, live)).toEqual([]);
  } finally {
    database.close();
  }
});

describe('catalog input boundary', () => {
  it('validates catalog rows and reports a malformed one', async () => {
    const malformed: FrozenDriver = {
      async execute() {
        return [{ schema: 'main', name: 42, type: 'table', wr: 0 }];
      },
    };

    await expect(createIntrospector('sqlite').snapshot(malformed)).rejects.toBeInstanceOf(CatalogRowError);
    await expect(createIntrospector('sqlite').snapshot(malformed)).rejects.toThrow(
      /sqlite pragma_table_list row 0 field "name" must be a string/,
    );

    const malformedFlag: FrozenDriver = {
      async execute() {
        return [{ schema: 'main', name: 'accounts', type: 'table', wr: 2 }];
      },
    };
    await expect(createIntrospector('sqlite').snapshot(malformedFlag)).rejects.toThrow(
      /sqlite pragma_table_list row 0 field "wr" must be 0 or 1/,
    );
  });

  it('binds a caller-supplied schema name instead of interpolating it', async () => {
    const schema = `tenant'); DROP SCHEMA public; --`;

    for (const dialect of ['postgres', 'mysql'] as const) {
      const calls: CompiledQuery[] = [];
      await createIntrospector(dialect).snapshot(
        {
          async execute(query) {
            calls.push(query);
            return [];
          },
        },
        { schemas: [schema] },
      );

      const scoped = calls.filter(
        call => call.text.includes('information_schema') || call.text.includes('pg_catalog.pg_index'),
      );
      expect(scoped.length, dialect).toBeGreaterThan(0);
      for (const call of scoped) {
        expect(call.text, dialect).not.toContain(schema);
        expect(call.parameters, dialect).toContain(schema);
      }
    }
  });

  it('applies SQLite affinity without inventing serial columns', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE exact_serial (id INTEGER PRIMARY KEY);
      CREATE TABLE descending_key (id INTEGER PRIMARY KEY DESC);
      CREATE TABLE int_key (id INT PRIMARY KEY);
      CREATE TABLE nullable_text_key (id TEXT PRIMARY KEY);
      CREATE TABLE composite_key (a INTEGER, b INTEGER, PRIMARY KEY (a, b));
      CREATE TABLE no_rowid (id INTEGER PRIMARY KEY) WITHOUT ROWID;
      CREATE TABLE affinities (
        sized VARCHAR(12),
        arbitrary STRING,
        bytes BLOB,
        untyped
      );
    `);

    try {
      const actual = await createIntrospector('sqlite').snapshot(sqliteDriver(database));
      expect(column(actual, 'exact_serial', 'id')).toMatchObject({ type: 'serial', nullable: false });
      expect(column(actual, 'descending_key', 'id')).toMatchObject({ type: 'integer', nullable: true });
      expect(column(actual, 'int_key', 'id').type).toBe('integer');
      expect(column(actual, 'nullable_text_key', 'id')).toMatchObject({ type: 'text', nullable: true });
      expect(column(actual, 'composite_key', 'a').type).toBe('integer');
      expect(column(actual, 'no_rowid', 'id').type).toBe('integer');
      expect(column(actual, 'affinities', 'sized')).toMatchObject({ type: 'varchar', length: 12 });
      expect(column(actual, 'affinities', 'arbitrary').type).toBe('numeric');
      expect(column(actual, 'affinities', 'bytes')).toMatchObject({ type: 'BLOB', catalogType: 'BLOB' });
      expect(column(actual, 'affinities', 'untyped')).toMatchObject({ type: '', catalogType: '' });
      expect(actual.warnings).toContainEqual({
        table: 'affinities',
        column: 'arbitrary',
        reason: 'SQLite declared type STRING was normalized by NUMERIC affinity',
      });
    } finally {
      database.close();
    }
  });
});

describe('the round trip and drift report', () => {
  it('round-trips a declaration through DDL, a real database and back', async () => {
    const declared = snapshot([RoundTripUserSchema]);
    const declaredTable = declared.tables[0];
    if (!declaredTable) throw new Error('the RoundTripUser declaration produced no table');

    const create: ChangeOp = {
      kind: 'create_table',
      table: declaredTable.name,
      columns: declaredTable.columns,
    };
    const database = new DatabaseSync(':memory:');
    const scratch = await mkdtemp(join(tmpdir(), 'zmdb-introspect-430-'));
    try {
      database.exec(emitUp(create, 'sqlite'));
      const live = await (await introspectorFor('sqlite')).snapshot(sqliteDriver(database));
      const emit = await frozenExport<FrozenEmitDeclarations>('emitDeclarations');
      const emitted = await emit(live, { dialect: 'sqlite' });

      for (const file of emitted.files) {
        const path = join(scratch, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.source);
      }
      const generated = emitted.files.find(file => file.source.includes('interface RoundTripUser'));
      if (!generated) throw new Error('emitter produced no RoundTripUser declaration');
      const project = join(scratch, 'tsconfig.json');
      await writeFile(
        project,
        `${JSON.stringify({ extends: join(ROOT, 'tsconfig.json'), include: ['./**/*.ts'] }, null, 2)}\n`,
      );
      const { RoundTripUser: regenerated } = schemasFrom(join(scratch, generated.path), ['RoundTripUser'], {
        project,
      });

      expect(coreProjection(snapshot([regenerated]))).toEqual(coreProjection(live));
    } finally {
      database.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.fails('excludes bookkeeping tables from the drift check', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const ledger = emptyTable('_zmdb_migrations', [
      { name: 'version', type: 'integer', nullable: false, primaryKey: true },
    ]);
    const report = detectDrift(emptySnapshot([ledger]), emptySnapshot());

    expect(report).toEqual({ onlyInDatabase: [], onlyInDeclarations: [], clean: true });
  });

  it.fails('reports drift in both directions', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const id: FrozenColumnSnapshot = { name: 'id', type: 'integer', nullable: false, primaryKey: true };
    const databaseOnly: FrozenColumnSnapshot = {
      name: 'database_only',
      type: 'text',
      nullable: false,
      primaryKey: false,
    };
    const declarationOnly: FrozenColumnSnapshot = {
      name: 'declaration_only',
      type: 'text',
      nullable: false,
      primaryKey: false,
    };
    const live = emptySnapshot([emptyTable('users', [databaseOnly, id])]);
    const declared = emptySnapshot([emptyTable('users', [declarationOnly, id])]);
    const report = detectDrift(live, declared);

    expect(report.clean).toBe(false);
    expect(report.onlyInDatabase).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: databaseOnly,
    });
    expect(report.onlyInDeclarations).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: declarationOnly,
    });
  });
});
