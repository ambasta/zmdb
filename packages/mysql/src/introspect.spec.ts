import { readFileSync } from 'node:fs';

import type { CatalogSchemaSnapshot } from '@zmdb/migrations/introspect';
import type { CompiledQuery } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { mysqlIntrospector } from './introspect.js';

interface MysqlCapture {
  readonly schema: string;
  readonly version: string;
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function rows(value: unknown, label: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((row, index) => record(row, `${label}[${String(index)}]`));
}

function capture(): MysqlCapture {
  const path = new URL('./__fixtures__/mysql-8.4.11.json', import.meta.url);
  const root = record(JSON.parse(readFileSync(path, 'utf8')), 'capture');
  const provenance = record(root['provenance'], 'capture.provenance');
  const server = record(provenance['server'], 'capture.provenance.server');
  const capturedRows = record(root['rows'], 'capture.rows');
  return {
    schema: text(provenance['schema'], 'capture.provenance.schema'),
    version: text(server['version'], 'capture.provenance.server.version'),
    rows: Object.fromEntries(
      Object.entries(capturedRows).map(([name, value]) => [name, rows(value, `capture.rows.${name}`)]),
    ),
  };
}

function fixtureDriver(
  fixture: MysqlCapture,
  overrideRows: MysqlCapture['rows'] = fixture.rows,
): {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
} {
  const catalogs: readonly [needle: string, key: string][] = [
    ['information_schema.referential_constraints', 'referentialConstraints'],
    ['information_schema.key_column_usage', 'keyColumnUsage'],
    ['information_schema.statistics', 'statistics'],
    ['information_schema.columns', 'columns'],
    ['information_schema.tables', 'tables'],
  ];
  return {
    async execute(query) {
      expect(query.parameters).toContain(fixture.schema);
      const match = catalogs.find(([needle]) => query.text.toLowerCase().includes(needle));
      if (match === undefined) throw new Error(`unrecorded MySQL catalog query: ${query.text}`);
      return (overrideRows[match[1]] ?? []).map(row => ({ ...row }));
    },
  };
}

function table(snapshot: CatalogSchemaSnapshot, name: string) {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`snapshot has no table "${name}"`);
  return found;
}

describe('MySQL catalog introspection', () => {
  it('reads the deterministic MySQL 8.4.11 capture', async () => {
    const fixture = capture();
    const snapshot = await mysqlIntrospector.snapshot(fixtureDriver(fixture), {
      schemas: [fixture.schema],
    });

    expect(fixture.version).toBe('8.4.11');
    expect(snapshot.tables.map(candidate => candidate.name)).toEqual(['accounts', 'memberships', 'posts']);
    expect(table(snapshot, 'memberships').primaryKey).toEqual(['user_id', 'tenant_id']);
    expect(table(snapshot, 'accounts').indexes).toContainEqual({
      name: 'accounts_email_uq',
      columns: ['email'],
      unique: true,
    });
    expect(table(snapshot, 'posts').foreignKeys).toEqual([
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

  it('round-trips keys indexes generated columns and foreign keys', async () => {
    const fixture = capture();
    const generatedColumn = {
      TABLE_NAME: 'posts',
      ORDINAL_POSITION: '5',
      COLUMN_NAME: 'slug_key',
      IS_NULLABLE: 'YES',
      DATA_TYPE: 'varchar',
      COLUMN_TYPE: 'varchar(120)',
      CHARACTER_MAXIMUM_LENGTH: '120',
      NUMERIC_PRECISION: null,
      NUMERIC_SCALE: null,
      COLUMN_DEFAULT: null,
      EXTRA: 'STORED GENERATED',
      GENERATION_EXPRESSION: 'lower(`slug`)',
    };
    const generatedIndex = {
      TABLE_NAME: 'posts',
      INDEX_NAME: 'posts_slug_key_idx',
      NON_UNIQUE: '1',
      SEQ_IN_INDEX: '1',
      COLUMN_NAME: 'slug_key',
      EXPRESSION: null,
      INDEX_TYPE: 'BTREE',
    };
    const augmented = {
      ...fixture.rows,
      columns: [...(fixture.rows['columns'] ?? []), generatedColumn],
      statistics: [...(fixture.rows['statistics'] ?? []), generatedIndex],
    };
    const snapshot = await mysqlIntrospector.snapshot(fixtureDriver(fixture, augmented), {
      schemas: [fixture.schema],
    });
    const posts = table(snapshot, 'posts');

    expect(posts.primaryKey).toEqual(['id']);
    expect(posts.indexes).toContainEqual({
      name: 'posts_slug_key_idx',
      columns: ['slug_key'],
      unique: false,
    });
    expect(posts.columns.find(column => column.name === 'slug_key')).toMatchObject({
      generated: { expression: 'lower(`slug`)', stored: true },
    });
    expect(posts.foreignKeys[0]?.name).toBe('posts_account_fkey');
  });

  it('normalizes the package-created MySQL foreign-key support index out of drift', async () => {
    const fixture = capture();
    const packageRows = {
      ...fixture.rows,
      statistics: (fixture.rows['statistics'] ?? []).map(row =>
        row['INDEX_NAME'] === 'posts_account_idx' ? { ...row, INDEX_NAME: 'posts_account_fkey_idx' } : row,
      ),
    };
    const live = await mysqlIntrospector.snapshot(fixtureDriver(fixture, packageRows), {
      schemas: [fixture.schema],
    });
    const normalized = mysqlIntrospector.normalizeForDrift(live, 'live');
    const posts = normalized.tables.find(candidate => candidate.name === 'posts');

    expect(posts).toBeDefined();
    expect(Reflect.get(posts ?? {}, 'indexes')).toEqual([]);
  });
});
