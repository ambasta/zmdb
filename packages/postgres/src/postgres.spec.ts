import type { ChangeOp } from '@zmdb/migrations';
import { createQueryCompiler, extendSqlDialect, type IntrospectionDriver } from '@zmdb/query-compiler';
import { describe, expect, it, vi } from 'vitest';

import {
  postgres,
  postgresDriver,
  postgresFamilyDriver,
  postgresFamilyIntrospector,
  postgresFamilyMigrations,
  postgresIntrospector,
  postgresOutboxPendingIndexDdl,
  postgresOutboxTableDdl,
  postgresVertical,
  type PgQueryable,
} from './index.js';

function catalogDriver(): IntrospectionDriver {
  return {
    async execute(query) {
      if (query.text.includes('information_schema.tables')) {
        return [
          { table_schema: 'app', table_name: 'accounts' },
          { table_schema: 'app', table_name: 'users' },
        ];
      }
      if (query.text.includes('information_schema.columns')) {
        const base = {
          character_maximum_length: null,
          column_default: null,
          is_generated: 'NEVER',
          generation_expression: null,
          attidentity: '',
          atttypmod: -1,
          typtype: 'b',
          domain_name: null,
          domain_base_type: null,
          extension_name: null,
        };
        return [
          {
            ...base,
            table_name: 'accounts',
            ordinal_position: 1,
            column_name: 'id',
            is_nullable: 'NO',
            data_type: 'integer',
            udt_name: 'int4',
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 1,
            column_name: 'id',
            is_nullable: 'NO',
            data_type: 'integer',
            udt_name: 'int4',
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 2,
            column_name: 'email',
            is_nullable: 'NO',
            data_type: 'USER-DEFINED',
            udt_name: 'citext',
            extension_name: 'citext',
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 3,
            column_name: 'account_id',
            is_nullable: 'YES',
            data_type: 'integer',
            udt_name: 'int4',
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 4,
            column_name: 'email_key',
            is_nullable: 'YES',
            data_type: 'text',
            udt_name: 'text',
            is_generated: 'ALWAYS',
            generation_expression: 'lower(email::text)',
          },
        ];
      }
      if (query.text.includes("constraint_type = 'PRIMARY KEY'")) {
        return [
          { table_name: 'accounts', column_name: 'id', ordinal_position: 1 },
          { table_name: 'users', column_name: 'id', ordinal_position: 1 },
        ];
      }
      if (query.text.includes("constraint_type = 'FOREIGN KEY'")) {
        return [
          {
            table_name: 'users',
            constraint_name: 'users_account_id_fkey',
            column_name: 'account_id',
            ordinal_position: 1,
            target_table: 'accounts',
            target_column: 'id',
            update_rule: 'CASCADE',
            delete_rule: 'SET NULL',
          },
        ];
      }
      if (query.text.includes('FROM pg_catalog.pg_index')) {
        return [
          {
            table_name: 'users',
            index_name: 'users_lower_email_idx',
            is_unique: true,
            is_primary: false,
            method: 'btree',
            predicate: 'account_id IS NOT NULL',
            position: 1,
            definition: 'lower(email::text)',
            operator_class: null,
          },
        ];
      }
      if (query.text.includes('FROM pg_catalog.pg_extension')) {
        return [{ name: 'citext', schema: 'public' }];
      }
      throw new Error(`unexpected catalog query: ${query.text}`);
    },
  };
}

describe('@zmdb/postgres vertical', () => {
  it('round-trips a schema through PostgreSQL and introspection', async () => {
    const operation: ChangeOp = {
      kind: 'create_table',
      table: 'users',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'email', type: 'text', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    expect(postgres.migrations.emitUp(operation)).toBe(
      'CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "email" TEXT NOT NULL)',
    );
    expect(createQueryCompiler(postgres).selectFrom('users').where('email', '=', 'a@example.test').compile()).toEqual({
      text: 'SELECT * FROM "users" WHERE "email" = $1',
      parameters: ['a@example.test'],
      returnsRows: true,
      operation: 'select',
      isWrite: false,
    });

    const catalog = await postgresIntrospector.snapshot(catalogDriver(), { schemas: ['app'] });
    expect(catalog.tables.map(table => table.name)).toEqual(['accounts', 'users']);
    expect(postgresIntrospector.normalizeForDrift(catalog, 'live').tables).toHaveLength(2);
  });

  it('preserves extensions expression indexes and referential actions', async () => {
    const catalog = await postgresIntrospector.snapshot(catalogDriver(), { schemas: ['app'] });
    expect(catalog.extensions).toEqual([{ name: 'citext' }]);
    expect(catalog.tables.find(table => table.name === 'users')).toMatchObject({
      foreignKeys: [{ onDelete: 'set null', onUpdate: 'cascade' }],
      indexes: [
        {
          name: 'users_lower_email_idx',
          columns: [{ expr: 'lower(email::text)' }],
          unique: true,
          where: 'account_id IS NOT NULL',
        },
      ],
    });
    const generated = catalog.tables
      .find(table => table.name === 'users')
      ?.columns.find(column => column.name === 'email_key');
    expect(Reflect.get(generated ?? {}, 'generated')).toEqual({
      expression: 'lower(email::text)',
      stored: true,
    });
    const normalizedUsers = postgresIntrospector
      .normalizeForDrift(catalog, 'live')
      .tables.find(table => table.name === 'users');
    expect(Reflect.get(normalizedUsers ?? {}, 'indexes')).toEqual([
      {
        name: 'users_lower_email_idx',
        columns: [{ expr: 'lower(email::text)' }],
        unique: true,
        where: 'account_id IS NOT NULL',
      },
    ]);
  });

  it('publishes immutable PostgreSQL-family extension points without child behavior', () => {
    const childIntrospector = postgresFamilyIntrospector('postgres-child');
    const childMigrations = postgresFamilyMigrations('postgres-child', { types: { integer: 'INT4' } });
    const childDialect = extendSqlDialect(postgres, {
      name: 'postgres-child',
      traits: {
        fts: 'none',
        retryableCodes: ['40001'],
        types: { integer: 'INT4' },
      },
      capabilities: { rowLevelSecurity: false },
      migrations: childMigrations,
      introspector: childIntrospector,
    });
    const childDriver = postgresFamilyDriver(childDialect, {
      async query() {
        return { rows: [] };
      },
    });

    expect(postgres.name).toBe('postgres');
    expect(postgres.family).toBe('postgres');
    expect(postgresVertical.dialect).toBe(postgres);
    expect(Object.isFrozen(postgres)).toBe(true);
    expect(Object.isFrozen(childIntrospector)).toBe(true);
    expect(childIntrospector.name).toBe('postgres-child');
    expect(childDialect.family).toBe('postgres');
    expect(childDialect.traits.fts).toBe('none');
    expect(childDialect.traits.retryableCodes).toEqual(['40001']);
    expect(childDialect.capabilities.rowLevelSecurity).toBe(false);
    expect(childDriver.dialect).toBe(childDialect);
    expect(
      childMigrations.ddlType({
        name: 'id',
        type: 'integer',
        nullable: false,
        primaryKey: true,
      }),
    ).toBe('INT4');
    expect(JSON.stringify(postgres)).not.toContain('cockroach');
  });

  it('accepts PostgreSQL JSON existence operators', () => {
    expect(postgres.traits.acceptsOperator('?')).toBe(true);
    expect(postgres.traits.acceptsOperator('?|')).toBe(true);
    expect(postgres.traits.acceptsOperator('?&')).toBe(true);
  });

  it('owns PostgreSQL schema-object and outbox spellings', () => {
    expect(
      postgres.migrations.emitSchemaObject({
        kind: 'create_index',
        definition: {
          name: 'users_email_idx',
          table: 'users',
          columns: [{ expr: 'lower(email::text)' }],
          unique: true,
          where: 'email IS NOT NULL',
        },
      }),
    ).toEqual(['CREATE UNIQUE INDEX "users_email_idx" ON "users" (lower(email::text)) WHERE email IS NOT NULL']);
    expect(postgresOutboxTableDdl()).toContain('"created_at" TIMESTAMPTZ');
    expect(postgresOutboxPendingIndexDdl()).toContain("WHERE status = 'pending'");
  });

  it('keeps a transaction on one checked-out client', async () => {
    const query = vi.fn(async (_request: unknown, _parameters?: readonly unknown[]) => ({
      rows: [] as Record<string, unknown>[],
    }));
    const release = vi.fn();
    const connection = { query, release };
    const pool = {
      totalCount: 1,
      idleCount: 1,
      query,
      connect: vi.fn(async () => connection),
    } as unknown as PgQueryable;

    await postgresDriver(pool).transaction(async transaction => {
      await transaction.execute({ text: 'SELECT 1', parameters: [] });
      await transaction.execute({ text: 'SELECT 2', parameters: [] });
    });

    expect(Reflect.get(pool, 'connect')).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'SELECT 1', 'SELECT 2', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('deallocates an evicted prepared statement', async () => {
    const query = vi.fn(async (_request: unknown, _parameters?: readonly unknown[]) => ({
      rows: [] as Record<string, unknown>[],
    }));
    const driver = postgresDriver({ query } as unknown as PgQueryable, { prepared: true, maxCacheSize: 1 });

    await driver.execute({ text: 'SELECT $1::int', parameters: [1] });
    await driver.execute({ text: 'SELECT ($1::int + 1)', parameters: [1] });

    expect(query.mock.calls.map(call => call[0])).toEqual([
      { name: 'zmdb_0', text: 'SELECT $1::int', values: [1] },
      'DEALLOCATE zmdb_0',
      { name: 'zmdb_1', text: 'SELECT ($1::int + 1)', values: [1] },
    ]);
  });

  it('omits cursor streaming when a structural client cannot pin a connection', () => {
    const query = vi.fn(async (_request: unknown, _parameters?: readonly unknown[]) => ({
      rows: [] as Record<string, unknown>[],
    }));
    expect(postgresDriver({ query } as unknown as PgQueryable).stream).toBeUndefined();
  });
});
