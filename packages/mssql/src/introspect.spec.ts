import { readFileSync } from 'node:fs';

import { CatalogRowError } from '@zmdb/migrations/introspect';
import type { CompiledQuery, IntrospectionDriver } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { mssqlIntrospector, type MssqlCatalogSchemaSnapshot } from './index.js';

interface Capture {
  readonly provenance: {
    readonly captureFormat: string;
    readonly imageDigest: string;
    readonly schema: string;
    readonly serverVersion: string;
  };
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${where} is not an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new TypeError(`${where} is not a string`);
  return value;
}

function rowList(value: unknown, where: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${where} is not an array`);
  return value.map((row, index) => record(row, `${where}[${String(index)}]`));
}

function capture(): Capture {
  const path = new URL('./__fixtures__/sql-server-2022.json', import.meta.url);
  const root = record(JSON.parse(readFileSync(path, 'utf8')), 'SQL Server capture');
  const provenance = record(root['provenance'], 'SQL Server capture.provenance');
  const rows = record(root['rows'], 'SQL Server capture.rows');
  return {
    provenance: {
      captureFormat: text(provenance['captureFormat'], 'captureFormat'),
      imageDigest: text(provenance['imageDigest'], 'imageDigest'),
      schema: text(provenance['schema'], 'schema'),
      serverVersion: text(provenance['serverVersion'], 'serverVersion'),
    },
    rows: Object.fromEntries(
      Object.entries(rows).map(([name, value]) => [name, rowList(value, `SQL Server capture.rows.${name}`)]),
    ),
  };
}

function catalogName(query: CompiledQuery): string {
  if (query.text.includes('FROM sys.key_constraints')) return 'primaryKeys';
  if (query.text.includes('FROM sys.foreign_keys')) return 'foreignKeys';
  if (query.text.includes('FROM sys.indexes')) return 'indexes';
  if (query.text.includes('FROM sys.sequences')) return 'sequences';
  if (query.text.includes('JOIN sys.columns c')) return 'columns';
  if (query.text.startsWith('SELECT s.name AS schema_name, t.name AS table_name ')) return 'tables';
  throw new Error(`unrecorded SQL Server catalog query: ${query.text}`);
}

function fixtureDriver(
  source: Capture,
  options: { readonly replace?: Readonly<Record<string, readonly Record<string, unknown>[]>> } = {},
): IntrospectionDriver {
  return {
    async execute(query) {
      if (!query.parameters.includes(source.provenance.schema)) {
        throw new Error(`SQL Server catalog query did not bind schema "${source.provenance.schema}"`);
      }
      const name = catalogName(query);
      return (options.replace?.[name] ?? source.rows[name] ?? []).map(row => ({ ...row }));
    },
  };
}

function table(snapshot: MssqlCatalogSchemaSnapshot, name: string) {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`snapshot has no table "${name}"`);
  return found;
}

describe('captured real SQL Server catalog rows (#672)', () => {
  it('records the SQL Server catalog fixture with exact server and image provenance', () => {
    const source = capture();

    expect(source.provenance).toEqual({
      captureFormat: 'node-mssql 12.7.0 recordsets returned by the six @zmdb/mssql catalog queries',
      imageDigest: 'sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89',
      schema: 'zmdb672_capture',
      serverVersion: '16.0.4265.3',
    });
    expect(source.rows['tables']).toHaveLength(2);
    expect(source.rows['columns']).toHaveLength(8);
    expect(source.rows['primaryKeys']).toHaveLength(2);
    expect(source.rows['foreignKeys']).toHaveLength(1);
    expect(source.rows['indexes']).toHaveLength(4);
    expect(source.rows['sequences']).toHaveLength(1);
  });

  it('reads columns identity keys indexes and foreign keys', async () => {
    const source = capture();
    const snapshot = await mssqlIntrospector.snapshot(fixtureDriver(source), {
      schemas: [source.provenance.schema],
    });
    const parents = table(snapshot, 'parents');
    const children = table(snapshot, 'children');

    expect(parents.primaryKey).toEqual(['id']);
    expect(parents.columns).toEqual([
      {
        name: 'active',
        type: 'boolean',
        catalogType: 'BIT',
        nullable: false,
        primaryKey: false,
        default: '((1))',
      },
      {
        name: 'guid',
        type: 'UNIQUEIDENTIFIER',
        catalogType: 'UNIQUEIDENTIFIER',
        nullable: false,
        primaryKey: false,
      },
      {
        name: 'happened_at',
        type: 'timestamp',
        catalogType: 'DATETIMEOFFSET(3)',
        nullable: false,
        primaryKey: false,
      },
      {
        name: 'id',
        type: 'serial',
        catalogType: 'INT',
        nullable: false,
        primaryKey: true,
        identity: {
          seed: '1',
          increment: '1',
        },
      },
      {
        name: 'label',
        type: 'varchar',
        catalogType: 'NVARCHAR(64)',
        nullable: false,
        primaryKey: false,
        length: 64,
      },
      {
        name: 'label_size',
        type: 'integer',
        catalogType: 'INT',
        nullable: true,
        primaryKey: false,
        computed: {
          expression: '(len([label]))',
          persisted: true,
        },
      },
    ]);
    expect(parents.indexes).toEqual([
      {
        name: 'parents_active_label',
        columns: ['label'],
        unique: false,
        where: '([active]=(1))',
        clustered: false,
        includedColumns: ['happened_at'],
        disabled: false,
      },
    ]);
    expect(children.foreignKeys).toEqual([
      {
        name: 'children_parent_fkey',
        columns: ['parent_id'],
        targetTable: 'parents',
        targetColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no action',
        disabled: false,
        trusted: true,
      },
    ]);
    expect(snapshot.sequences).toEqual([
      {
        name: 'event_sequence',
        schema: source.provenance.schema,
        catalogType: 'BIGINT',
        start: '10',
        increment: '5',
      },
    ]);
    expect(snapshot.warnings).toEqual([
      {
        table: 'parents',
        reason:
          'SQL Server index "parents_active_label" includes happened_at; ' +
          'included columns are preserved as catalog evidence but not emitted by the current DDL vocabulary',
      },
    ]);
  });

  it('applies include and exclude globs without omitting catalog queries', async () => {
    const source = capture();
    const calls: string[] = [];
    const sourceDriver = fixtureDriver(source);
    const driver: IntrospectionDriver = {
      execute: async query => {
        calls.push(catalogName(query));
        return sourceDriver.execute(query);
      },
    };

    const snapshot = await mssqlIntrospector.snapshot(driver, {
      schemas: [source.provenance.schema],
      include: ['p*'],
      exclude: ['*_archive'],
    });

    expect(snapshot.tables.map(candidate => candidate.name)).toEqual(['parents']);
    expect(calls.toSorted()).toEqual(['columns', 'foreignKeys', 'indexes', 'primaryKeys', 'sequences', 'tables']);
  });

  it('rejects malformed SQL Server catalog flags before normalizing them', async () => {
    const source = capture();
    const columns = (source.rows['columns'] ?? []).map(row => ({ ...row }));
    const first = columns[0];
    if (first === undefined) throw new Error('captured SQL Server columns are empty');
    columns[0] = { ...first, is_nullable: 'NO' };

    const result = mssqlIntrospector.snapshot(fixtureDriver(source, { replace: { columns } }), {
      schemas: [source.provenance.schema],
    });
    await expect(result).rejects.toBeInstanceOf(CatalogRowError);
    await expect(result).rejects.toThrow('mssql sys.columns row 0 field "is_nullable" must be a boolean or 0/1 flag');
  });

  it('refuses duplicate table names across selected schemas instead of dropping the schema fact', async () => {
    const source = capture();
    const tables = [
      { schema_name: source.provenance.schema, table_name: 'parents' },
      { schema_name: 'tenant_two', table_name: 'parents' },
    ];
    const driver: IntrospectionDriver = {
      async execute(query) {
        if (catalogName(query) === 'tables') return tables;
        return [];
      },
    };

    await expect(
      mssqlIntrospector.snapshot(driver, {
        schemas: [source.provenance.schema, 'tenant_two'],
      }),
    ).rejects.toThrow(
      'mssql introspection cannot represent table "parents" from more than one schema in a schema-neutral snapshot',
    );
  });
});
