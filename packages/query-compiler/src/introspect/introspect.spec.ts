import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { CompiledQuery, Dialect } from '../index.js';
import { type ChangeOp, type ColumnSnapshot, type SchemaSnapshot, type TableSnapshot } from '../migrations/index.js';
import { normalizeDriftSnapshot } from './drift.js';
import { createIntrospector } from './index.js';

// Introspection tests freeze for #430. The MySQL rows are the byte-for-byte textual
// capture in __fixtures__/mysql-8.4.11.json; its provenance test is green today.
// SQLite catalog, DDL and declaration round-trip evidence lives in @zmdb/sqlite.

type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
type FrozenIndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

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

interface FrozenDriftReport {
  readonly onlyInDatabase: readonly ChangeOp[];
  readonly onlyInDeclarations: readonly ChangeOp[];
  readonly clean: boolean;
}

type FrozenDetectDrift = (
  live: FrozenSchemaSnapshot,
  declared: FrozenSchemaSnapshot,
  options?: { readonly exclude?: readonly string[]; readonly dialect?: Dialect },
) => FrozenDriftReport;

async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('./index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/query-compiler exports no "${name}" (frozen: introspect/SPEC.md 1)`);
  }
  return value as T;
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

describe('catalog input boundary', () => {
  it('directs SQLite introspection callers to @zmdb/sqlite', () => {
    expect(() => createIntrospector('sqlite')).toThrow(
      'SQLite schema introspection is shipped by @zmdb/sqlite; use sqlite.introspector or sqliteIntrospector',
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
});

describe('the drift report', () => {
  it('excludes bookkeeping tables from the drift check', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const ledger = emptyTable('_zmdb_migrations', [
      { name: 'version', type: 'integer', nullable: false, primaryKey: true },
    ]);
    const report = detectDrift(emptySnapshot([ledger]), emptySnapshot());

    expect(report).toEqual({ onlyInDatabase: [], onlyInDeclarations: [], clean: true });
  });

  it('accepts a configurable drift exclusion list', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const shadow = emptyTable('audit_shadow', [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }]);
    const report = detectDrift(emptySnapshot([shadow]), emptySnapshot(), {
      exclude: ['_zmdb_migrations', 'audit_*'],
    });

    expect(report).toEqual({ onlyInDatabase: [], onlyInDeclarations: [], clean: true });
  });

  it('reports drift in both directions', async () => {
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

  it('ignores a default expression the database normalised', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const live = emptySnapshot([
      emptyTable('events', [
        {
          name: 'created_at',
          type: 'timestamp',
          catalogType: 'timestamp with time zone',
          nullable: false,
          primaryKey: false,
          default: "'now()'",
        },
      ]),
    ]);
    const declared = emptySnapshot([
      emptyTable('events', [
        {
          name: 'created_at',
          type: 'timestamp',
          catalogType: 'timestamptz',
          nullable: false,
          primaryKey: false,
          default: 'now()',
        },
      ]),
    ]);

    const normalized = normalizeDriftSnapshot(live, 'live');
    expect(normalized.tables[0]?.columns[0]).toEqual({
      name: 'created_at',
      type: 'timestamp',
      nullable: false,
      primaryKey: false,
    });
    expect(column(live, 'events', 'created_at').default).toBe("'now()'");
    expect(detectDrift(live, declared)).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });

  it('ignores an index MySQL created to support a foreign key', async () => {
    const detectDrift = await frozenExport<FrozenDetectDrift>('detectDrift');
    const foreignKey: FrozenForeignKeySnapshot = {
      name: 'posts_account_id_fkey',
      columns: ['account_id'],
      targetTable: 'accounts',
      targetColumns: ['id'],
      onDelete: 'cascade',
      onUpdate: 'no action',
    };
    const accountId: FrozenColumnSnapshot = {
      name: 'account_id',
      type: 'integer',
      nullable: false,
      primaryKey: false,
    };
    const generatedIndex: FrozenIndexSnapshot = {
      name: 'posts_account_id_fkey_idx',
      columns: ['account_id'],
      unique: false,
    };
    const explicitIndex: FrozenIndexSnapshot = {
      name: 'posts_recent_idx',
      columns: ['account_id'],
      unique: false,
    };
    const liveTable: FrozenTableSnapshot = {
      ...emptyTable('posts', [accountId]),
      foreignKeys: [foreignKey],
      indexes: [generatedIndex, explicitIndex],
    };
    const declaredTable: FrozenTableSnapshot = {
      ...emptyTable('posts', [accountId]),
      foreignKeys: [foreignKey],
      indexes: [explicitIndex],
    };
    const live = emptySnapshot([liveTable]);
    const declared = emptySnapshot([declaredTable]);

    const normalized = normalizeDriftSnapshot(live, 'live', { dialect: 'mysql' });
    expect(normalized.tables[0]?.indexes).toEqual([explicitIndex]);
    expect(table(live, 'posts').indexes).toEqual([generatedIndex, explicitIndex]);
    expect(detectDrift(live, declared, { dialect: 'mysql' })).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });
});
