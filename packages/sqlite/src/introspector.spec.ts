import { DatabaseSync } from 'node:sqlite';

import {
  CatalogRowError,
  type CatalogColumnSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type IntrospectionDriver,
} from '@zmdb/migrations/introspect';
import { describe, expect, it } from 'vitest';

import { sqliteDriver } from './driver.js';
import { sqliteIntrospector } from './introspector.js';

function plainRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(Object.entries(row)));
}

function fixture(): DatabaseSync {
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

function table(snapshot: CatalogSchemaSnapshot, name: string): CatalogTableSnapshot {
  const found = snapshot.tables.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`snapshot has no table "${name}"`);
  return found;
}

function column(snapshot: CatalogSchemaSnapshot, tableName: string, name: string): CatalogColumnSnapshot {
  const found = table(snapshot, tableName).columns.find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`snapshot has no column "${tableName}.${name}"`);
  return found;
}

describe('sqlite catalog introspection', () => {
  it('captures the SQLite catalog rows used by the freeze', () => {
    const database = fixture();
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
    const database = fixture();
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));

      expect(actual.tables.map(candidate => candidate.name)).toEqual(['accounts', 'memberships', 'posts']);
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

  it('reads a composite primary key in declaration order', async () => {
    const database = fixture();
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
      expect(table(actual, 'memberships').primaryKey).toEqual(['user_id', 'tenant_id']);
    } finally {
      database.close();
    }
  });

  it('reads foreign keys with their referential actions', async () => {
    const database = fixture();
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
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

  it('reads indexes including a unique one and an expression one', async () => {
    const database = fixture();
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
      expect(table(actual, 'posts').indexes).toEqual([
        { name: 'posts_lower_slug_idx', columns: [{ expr: 'lower(slug)' }], unique: false },
        { name: 'posts_slug_uq', columns: ['slug'], unique: true },
      ]);
    } finally {
      database.close();
    }
  });

  it('preserves column default expressions', async () => {
    const database = fixture();
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
      expect(column(actual, 'accounts', 'status').default).toBe("'active'");
      expect(column(actual, 'accounts', 'created_at').default).toBe('CURRENT_TIMESTAMP');
    } finally {
      database.close();
    }
  });

  it('warns instead of silently treating generated columns as writable columns', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE people (
        first TEXT NOT NULL,
        last TEXT NOT NULL,
        full_name TEXT GENERATED ALWAYS AS (first || ' ' || last) STORED
      );
    `);
    try {
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
      expect(table(actual, 'people').columns.map(candidate => candidate.name)).toEqual(['first', 'last']);
      expect(actual.warnings).toContainEqual({
        table: 'people',
        column: 'full_name',
        reason:
          'SQLite stored generated column is omitted because the portable schema snapshot does not carry generated expressions',
      });
    } finally {
      database.close();
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
      const actual = await sqliteIntrospector.snapshot(sqliteDriver(database));
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

  it('validates malformed SQLite catalog rows at the package boundary', async () => {
    const malformed: IntrospectionDriver = {
      async execute() {
        return [{ schema: 'main', name: 42, type: 'table', wr: 0 }];
      },
    };
    await expect(sqliteIntrospector.snapshot(malformed)).rejects.toBeInstanceOf(CatalogRowError);
    await expect(sqliteIntrospector.snapshot(malformed)).rejects.toThrow(
      /sqlite pragma_table_list row 0 field "name" must be a string/,
    );

    const malformedFlag: IntrospectionDriver = {
      async execute() {
        return [{ schema: 'main', name: 'accounts', type: 'table', wr: 2 }];
      },
    };
    await expect(sqliteIntrospector.snapshot(malformedFlag)).rejects.toThrow(
      /sqlite pragma_table_list row 0 field "wr" must be 0 or 1/,
    );
  });
});
