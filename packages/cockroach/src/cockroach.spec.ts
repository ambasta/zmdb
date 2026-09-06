import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { postgres, type PgQueryable } from '@zmdb/postgres';
import { createQueryCompiler, UnsupportedFeatureError, type IntrospectionDriver } from '@zmdb/query-compiler';
import type { TxConnection } from '@zmdb/repository';
import { createTransactionalDb } from '@zmdb/repository';
import { describe, expect, it } from 'vitest';

import { cockroach, cockroachDriver, cockroachIntrospector } from './index.js';

class RetryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function retryConnection(): TxConnection & { readonly log: string[] } {
  const log: string[] = [];
  return {
    dialect: cockroach,
    log,
    async raw(sql) {
      log.push(sql);
    },
    async execute() {
      return [];
    },
  };
}

function catalogDriver(): IntrospectionDriver {
  return {
    async execute(compiled) {
      if (compiled.text.includes('information_schema.tables')) {
        return [{ table_schema: 'app', table_name: 'users' }];
      }
      if (compiled.text.includes('information_schema.columns')) {
        const base = {
          character_maximum_length: null,
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
            table_name: 'users',
            ordinal_position: 1,
            column_name: 'id',
            is_nullable: 'NO',
            data_type: 'bigint',
            udt_name: 'int8',
            column_default: 'unique_rowid()',
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 2,
            column_name: 'email',
            is_nullable: 'NO',
            data_type: 'text',
            udt_name: 'text',
            column_default: null,
          },
          {
            ...base,
            table_name: 'users',
            ordinal_position: 3,
            column_name: 'active',
            is_nullable: 'NO',
            data_type: 'boolean',
            udt_name: 'bool',
            column_default: 'true',
          },
        ];
      }
      if (compiled.text.includes("constraint_type = 'PRIMARY KEY'")) {
        return [{ table_name: 'users', column_name: 'id', ordinal_position: 1 }];
      }
      if (compiled.text.includes("constraint_type = 'FOREIGN KEY'")) return [];
      if (compiled.text.includes('FROM pg_catalog.pg_index')) return [];
      if (compiled.text.includes('FROM pg_catalog.pg_extension')) return [];
      if (compiled.text.startsWith('SHOW INDEXES')) {
        return [
          {
            index_name: 'users_pkey',
            non_unique: false,
            seq_in_index: 1,
            column_name: 'id',
            definition: 'id',
            storing: false,
            implicit: false,
          },
          {
            index_name: 'users_lower_email_idx',
            non_unique: false,
            seq_in_index: 1,
            column_name: 'crdb_internal_idx_expr',
            definition: '(lower(email))',
            storing: false,
            implicit: false,
          },
          {
            index_name: 'users_lower_email_idx',
            non_unique: false,
            seq_in_index: 2,
            column_name: 'id',
            definition: 'id',
            storing: true,
            implicit: true,
          },
        ];
      }
      if (compiled.text.startsWith('SHOW CONSTRAINTS')) {
        return [
          {
            constraint_name: 'users_pkey',
            constraint_type: 'PRIMARY KEY',
          },
          {
            constraint_name: 'users_lower_email_idx',
            constraint_type: 'UNIQUE',
          },
        ];
      }
      if (compiled.text.startsWith('SHOW CREATE TABLE')) {
        return [
          {
            create_statement:
              'CREATE TABLE app.users (\n' +
              '\tid INT8 NOT NULL DEFAULT unique_rowid(),\n' +
              '\temail STRING NOT NULL,\n' +
              '\tactive BOOL NOT NULL DEFAULT true,\n' +
              '\tCONSTRAINT users_pkey PRIMARY KEY (id ASC),\n' +
              '\tUNIQUE INDEX users_lower_email_idx (lower(email) ASC) WHERE active\n' +
              ');',
          },
        ];
      }
      throw new Error(`unexpected catalog query: ${compiled.text}`);
    },
  };
}

describe('@zmdb/cockroach vertical', () => {
  it('inherits unchanged PostgreSQL compiler behaviour', () => {
    const postgresQuery = createQueryCompiler(postgres)
      .selectFrom('users')
      .where('email', '=', 'a@example.test')
      .compile();
    const cockroachQuery = createQueryCompiler(cockroach)
      .selectFrom('users')
      .where('email', '=', 'a@example.test')
      .compile();

    expect(cockroach.family).toBe('postgres');
    expect(cockroachQuery).toEqual(postgresQuery);
    expect(cockroach.traits.placeholder).toBe(postgres.traits.placeholder);
    expect(cockroach.traits.quote).toEqual(postgres.traits.quote);
    expect(cockroach.traits.returning).toEqual(postgres.traits.returning);
  });

  it('cannot mutate PostgreSQL traits', () => {
    expect(Object.isFrozen(cockroach)).toBe(true);
    expect(Object.isFrozen(cockroach.traits)).toBe(true);
    expect(Object.isFrozen(cockroach.traits.types)).toBe(true);
    expect(Reflect.set(cockroach.traits.types, 'text', 'BROKEN')).toBe(false);
    expect(cockroach.traits.types.text).toBe('TEXT');
    expect(postgres.traits.types.text).toBe('TEXT');
    expect(postgres.traits.retryableCodes).toEqual(['40001', '40P01']);
  });

  it('maps serial to the frozen Cockroach strategy', () => {
    expect(
      cockroach.migrations.ddlType({
        name: 'id',
        type: 'serial',
        nullable: false,
        primaryKey: true,
      }),
    ).toBe('INT8 DEFAULT unique_rowid()');
    expect(
      cockroach.migrations.ddlType({
        name: 'count',
        type: 'integer',
        nullable: false,
        primaryKey: false,
      }),
    ).toBe('INT4');
    expect(cockroach.traits.types.serial).toBe('INT8 DEFAULT unique_rowid()');
    expect(cockroach.traits.types.integer).toBe('INT4');
  });

  it('retries 40001 only when explicitly enabled', async () => {
    const withoutRetry = retryConnection();
    let attempts = 0;
    await expect(
      createTransactionalDb(withoutRetry).transaction(async () => {
        attempts += 1;
        throw new RetryError('40001');
      }),
    ).rejects.toThrow('40001');
    expect(attempts).toBe(1);
    expect(withoutRetry.log).toEqual(['BEGIN', 'ROLLBACK']);

    const withRetry = retryConnection();
    attempts = 0;
    await expect(
      createTransactionalDb(withRetry).transaction(
        async () => {
          attempts += 1;
          if (attempts < 3) throw new RetryError('40001');
          return 'committed';
        },
        { retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } },
      ),
    ).resolves.toBe('committed');
    expect(attempts).toBe(3);
    expect(withRetry.log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  });

  it('refuses row-level security while retaining supported inherited features', () => {
    expect(cockroach.traits.fts).toBe('none');
    expect(cockroach.capabilities.rowLevelSecurity).toBe(false);
    expect(cockroach.capabilities.transactionalDdl).toBe(false);
    expect(cockroach.capabilities.cancellation).toBe(false);
    expect(cockroach.capabilities.streaming).toBe(true);
    expect(cockroach.capabilities.generatedColumns).toBe(true);
    expect(
      cockroach.migrations.emitSchemaObject({
        kind: 'create_view',
        definition: { name: 'active_users', select: 'SELECT * FROM users', materialized: true },
      }),
    ).toEqual(['CREATE MATERIALIZED VIEW "active_users" AS SELECT * FROM users']);

    expect(() => cockroach.migrations.emitSchemaObject({ kind: 'enable_rls', table: 'users' })).toThrow(
      expect.objectContaining({
        name: 'UnsupportedFeatureError',
        feature: 'row-level security',
        dialect: 'cockroach',
      }),
    );
    expect(() =>
      cockroach.migrations.emitSchemaObject({
        kind: 'create_extension',
        definition: { name: 'citext' },
      }),
    ).toThrow(UnsupportedFeatureError);
    expect(() =>
      cockroach.migrations.emitSchemaObject({
        kind: 'create_index',
        definition: { name: 'users_email_idx', table: 'users', columns: ['email'], method: 'btree' },
      }),
    ).toThrow(UnsupportedFeatureError);

    const client: PgQueryable = {
      async query() {
        return { rows: [] };
      },
    };
    expect(() => cockroachDriver(client, { cancelVia: client })).toThrow(
      expect.objectContaining({
        feature: 'server-side cancellation',
        dialect: 'cockroach',
      }),
    );
    const migrationConnection = cockroach.migrations.connection({
      dialect: cockroach,
      async execute() {
        return [];
      },
    });
    expect(migrationConnection.transactionalDdl).toBe(false);
    expect(migrationConnection.transaction).toBeUndefined();
  });

  it('normalizes Cockroach serials and SHOW indexes for clean drift', async () => {
    const snapshot = await cockroachIntrospector.snapshot(catalogDriver(), { schemas: ['app'] });
    expect(snapshot.tables[0]).toMatchObject({
      name: 'users',
      columns: [
        { name: 'active', type: 'boolean' },
        { name: 'email', type: 'text' },
        { name: 'id', type: 'serial' },
      ],
      indexes: [
        {
          name: 'users_lower_email_idx',
          columns: [{ expr: 'lower(email)' }],
          unique: true,
          where: 'active',
        },
      ],
    });
    expect(snapshot.tables[0]?.columns.find(column => column.name === 'id')).not.toHaveProperty('default');
    const normalized = cockroachIntrospector.normalizeForDrift(snapshot, 'live');
    expect(normalized.tables[0]?.name).toBe('users');
    expect(normalized.tables[0]?.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'serial' })]),
    );
  });

  it('packed consumer imports no PostgreSQL internals', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, '../../..');
    const childManifest = JSON.parse(await readFile(resolve(root, 'packages/cockroach/package.json'), 'utf8'));
    const parentManifest = JSON.parse(await readFile(resolve(root, 'packages/postgres/package.json'), 'utf8'));
    const fixtureRuntime = await readFile(resolve(root, 'fixtures/database-cockroach/src/runtime.mjs'), 'utf8');
    const sources = await Promise.all(
      ['index.ts', 'introspect.ts', 'migrations.ts'].map(name =>
        readFile(resolve(root, 'packages/cockroach/src', name), 'utf8'),
      ),
    );

    expect(childManifest.dependencies['@zmdb/postgres']).toBe('workspace:1.0.0-alpha.4');
    expect(parentManifest.dependencies?.['@zmdb/cockroach']).toBeUndefined();
    expect(sources.join('\n')).not.toMatch(/@zmdb\/postgres(?:\/src|\/[^'"]+)/);
    expect(fixtureRuntime).toContain("from '@zmdb/cockroach'");
    expect(fixtureRuntime).not.toMatch(/@zmdb\/postgres(?:\/src|\/[^'"]+)/);
  });
});
