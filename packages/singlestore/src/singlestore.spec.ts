import { diff, snapshot, type ChangeOp, type SchemaSnapshot, type SnapshotableSchema } from '@zmdb/migrations';
import { mysql, type MysqlQueryable } from '@zmdb/mysql';
import { createQueryCompiler, UnsupportedFeatureError, type IntrospectionDriver } from '@zmdb/query-compiler';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { outboxTableDdl } from '@zmdb/query-compiler/outbox';
import { describe, expect, it } from 'vitest';

import { singlestore, singlestoreDriver, singlestoreIntrospector } from './index.js';

const EMPTY: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

const orders: SnapshotableSchema = {
  table: 'orders',
  columns: {
    id: { type: 'bigint', flags: { nullable: false, primaryKey: true } },
    tenantId: { type: 'bigint', flags: { nullable: false, primaryKey: true } },
  },
  primaryKey: ['tenantId', 'id'],
  ir: {
    table: 'orders',
    columns: [{ name: 'id' }, { name: 'tenantId', physicalName: 'tenant_id' }],
    tableOptions: {
      shardKey: ['tenantId'],
      sortKey: ['id'],
    },
  },
};

function catalogDriver(): IntrospectionDriver {
  return {
    async execute(compiled) {
      if (compiled.text.startsWith('SHOW CREATE TABLE')) {
        return [
          {
            'Create Table':
              'CREATE TABLE `orders` (\n' +
              '  `id` bigint(20) NOT NULL,\n' +
              '  `tenant_id` bigint(20) NOT NULL,\n' +
              '  PRIMARY KEY (`tenant_id`,`id`),\n' +
              '  SHARD KEY `__SHARDKEY` (`tenant_id`),\n' +
              '  SORT KEY `id` (`id`)\n' +
              ')',
          },
        ];
      }
      if (compiled.text.includes('STORAGE_TYPE')) {
        return [{ TABLE_SCHEMA: 'app', TABLE_NAME: 'orders', STORAGE_TYPE: 'COLUMNSTORE' }];
      }
      if (compiled.text.includes('information_schema.TABLES')) {
        return [{ TABLE_SCHEMA: 'app', TABLE_NAME: 'orders', TABLE_TYPE: 'BASE TABLE', ENGINE: 'MEMSQL' }];
      }
      if (compiled.text.includes('information_schema.COLUMNS')) {
        const common = {
          IS_NULLABLE: 'NO',
          DATA_TYPE: 'bigint',
          COLUMN_TYPE: 'bigint(20)',
          CHARACTER_MAXIMUM_LENGTH: null,
          NUMERIC_PRECISION: 64,
          NUMERIC_SCALE: 0,
          COLUMN_DEFAULT: null,
          EXTRA: '',
          GENERATION_EXPRESSION: '',
        };
        return [
          { ...common, TABLE_NAME: 'orders', ORDINAL_POSITION: 1, COLUMN_NAME: 'id' },
          { ...common, TABLE_NAME: 'orders', ORDINAL_POSITION: 2, COLUMN_NAME: 'tenant_id' },
          {
            ...common,
            TABLE_NAME: 'orders',
            ORDINAL_POSITION: 3,
            COLUMN_NAME: 'created_at',
            DATA_TYPE: 'datetime',
            COLUMN_TYPE: 'datetime(6)',
          },
        ];
      }
      if (compiled.text.includes('information_schema.STATISTICS')) {
        return [
          {
            TABLE_NAME: 'orders',
            INDEX_NAME: 'PRIMARY',
            NON_UNIQUE: 0,
            SEQ_IN_INDEX: 1,
            COLUMN_NAME: 'tenant_id',
            EXPRESSION: null,
            INDEX_TYPE: 'COLUMNSTORE HASH',
          },
          {
            TABLE_NAME: 'orders',
            INDEX_NAME: 'PRIMARY',
            NON_UNIQUE: 0,
            SEQ_IN_INDEX: 2,
            COLUMN_NAME: 'id',
            EXPRESSION: null,
            INDEX_TYPE: 'COLUMNSTORE HASH',
          },
          {
            TABLE_NAME: 'orders',
            INDEX_NAME: '__SHARDKEY',
            NON_UNIQUE: 1,
            SEQ_IN_INDEX: 1,
            COLUMN_NAME: 'tenant_id',
            EXPRESSION: null,
            INDEX_TYPE: 'SHARD',
          },
          {
            TABLE_NAME: 'orders',
            INDEX_NAME: 'id',
            NON_UNIQUE: 1,
            SEQ_IN_INDEX: 2,
            COLUMN_NAME: 'id',
            EXPRESSION: null,
            INDEX_TYPE: 'CLUSTERED COLUMNSTORE',
          },
        ];
      }
      if (compiled.text.includes('information_schema.KEY_COLUMN_USAGE')) {
        return [
          {
            TABLE_NAME: 'orders',
            CONSTRAINT_NAME: 'PRIMARY',
            ORDINAL_POSITION: 1,
            POSITION_IN_UNIQUE_CONSTRAINT: null,
            COLUMN_NAME: 'tenant_id',
            REFERENCED_TABLE_NAME: null,
            REFERENCED_COLUMN_NAME: null,
          },
          {
            TABLE_NAME: 'orders',
            CONSTRAINT_NAME: 'PRIMARY',
            ORDINAL_POSITION: 2,
            POSITION_IN_UNIQUE_CONSTRAINT: null,
            COLUMN_NAME: 'id',
            REFERENCED_TABLE_NAME: null,
            REFERENCED_COLUMN_NAME: null,
          },
        ];
      }
      if (compiled.text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) return [];
      throw new Error(`unexpected catalog query: ${compiled.text}`);
    },
  };
}

describe('@zmdb/singlestore vertical', () => {
  it('inherits MySQL placeholders and quoting', () => {
    const parent = createQueryCompiler(mysql).selectFrom('users').where('email', '=', 'a@example.test').compile();
    const child = createQueryCompiler(singlestore).selectFrom('users').where('email', '=', 'a@example.test').compile();

    expect(child).toEqual(parent);
    expect(singlestore.family).toBe('mysql');
    expect(singlestore.traits.placeholder).toBe(mysql.traits.placeholder);
    expect(singlestore.traits.quote).toEqual(mysql.traits.quote);
    expect(singlestore.traits.types.serial).toBe('BIGINT AUTO_INCREMENT');
    expect(singlestore.traits.types.timestamp).toBe('DATETIME(6)');
  });

  it('owns rowstore outbox DDL', () => {
    const ddl = outboxTableDdl(singlestore);
    expect(ddl).toMatch(/^CREATE ROWSTORE TABLE `zmdb_outbox`/);
    expect(ddl).toContain('`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
    expect(ddl).toContain("`lease_until` DATETIME(6) NOT NULL DEFAULT '1970-01-01 00:00:00.000000'");
  });

  it('removes the MySQL-only natural-language suffix from full-text queries', () => {
    expect(ftsSelectFrom('documents', singlestore).whereMatch('body', 'single').compile()).toEqual({
      text: 'SELECT * FROM `documents` WHERE MATCH(`body`) AGAINST(?)',
      parameters: ['single'],
      returnsRows: true,
      operation: 'select',
      isWrite: false,
    });
  });

  it('cannot mutate MySQL traits', () => {
    expect(Object.isFrozen(singlestore)).toBe(true);
    expect(Object.isFrozen(singlestore.traits)).toBe(true);
    expect(Object.isFrozen(singlestore.traits.types)).toBe(true);
    expect(Reflect.set(singlestore.traits.types, 'text', 'BROKEN')).toBe(false);
    expect(singlestore.traits.types.text).toBe('TEXT');
    expect(mysql.traits.types.text).toBe('TEXT');
    expect(mysql.traits.types.serial).toBe('INT AUTO_INCREMENT');
  });

  it('carries shard and sort keys through snapshot diff and DDL', () => {
    const declared = snapshot([orders]);
    expect(declared.tables[0]?.tableOptions).toEqual({ shardKey: ['tenant_id'], sortKey: ['id'] });
    const operations = diff(EMPTY, declared, { dialect: singlestore });
    expect(operations).toHaveLength(1);
    const operation = operations[0];
    if (operation?.kind !== 'create_table') throw new Error('expected one create_table operation');
    expect(singlestore.migrations.emitUp(operation)).toBe(
      'CREATE TABLE `orders` (`id` BIGINT NOT NULL, `tenant_id` BIGINT NOT NULL, ' +
        'PRIMARY KEY (`tenant_id`, `id`), SHARD KEY (`tenant_id`), SORT KEY (`id`))',
    );
  });

  it('refuses foreign keys before execution', () => {
    const operation: Extract<ChangeOp, { readonly kind: 'create_table' }> = {
      kind: 'create_table',
      table: 'orders',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'user_id', type: 'bigint', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'orders_user_fkey',
          columns: ['user_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'restrict',
        },
      ],
      tableOptions: { rowstore: true },
    };
    expect(() => singlestore.migrations.emitUp(operation)).toThrow(
      expect.objectContaining({
        name: 'UnsupportedFeatureError',
        dialect: 'singlestore',
        feature: 'foreign keys',
      }),
    );
  });

  it('refuses an incompatible unique index before execution', () => {
    expect(() =>
      singlestore.migrations.emitUp({
        kind: 'create_table',
        table: 'users',
        columns: [
          { name: 'tenant_id', type: 'bigint', nullable: false, primaryKey: false },
          { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false, unique: true },
        ],
        primaryKey: [],
        foreignKeys: [],
        tableOptions: { shardKey: ['tenant_id'] },
      }),
    ).toThrow('cannot enforce UNIQUE on "users"."email"');
  });

  it('refuses a unique column on an unsharded rowstore before execution', () => {
    expect(() =>
      singlestore.migrations.emitUp({
        kind: 'create_table',
        table: 'rowstore_users',
        columns: [
          { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar', length: 255, nullable: false, primaryKey: false, unique: true },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        tableOptions: { rowstore: true },
      }),
    ).toThrow('whole shard key (none declared)');
  });

  it('refuses a sort key on an explicit rowstore before execution', () => {
    expect(() =>
      singlestore.migrations.emitUp({
        kind: 'create_table',
        table: 'rowstore_events',
        columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
        primaryKey: ['id'],
        foreignKeys: [],
        tableOptions: { rowstore: true, sortKey: ['id'] },
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'UnsupportedFeatureError',
        dialect: 'singlestore',
        feature: 'sort key on rowstore table "rowstore_events"',
      }),
    );
  });

  it('detects table storage changes', () => {
    const before = snapshot([orders]);
    const table = before.tables[0];
    if (table === undefined) throw new Error('orders snapshot is absent');
    const after: SchemaSnapshot = {
      ...before,
      tables: [{ ...table, tableOptions: { rowstore: true } }],
    };
    expect(() => diff(before, after, { dialect: singlestore })).toThrow('create a replacement table and copy the data');
  });

  it('reads SingleStore catalog metadata', async () => {
    const catalog = await singlestoreIntrospector.snapshot(catalogDriver(), { schemas: ['app'] });
    expect(catalog.tables).toEqual([
      expect.objectContaining({
        name: 'orders',
        primaryKey: ['tenant_id', 'id'],
        indexes: [],
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'created_at', type: 'timestamp', catalogType: 'datetime(6)' }),
        ]),
        tableOptions: {
          shardKey: ['tenant_id'],
          sortKey: ['id'],
        },
      }),
    ]);
    expect(catalog.warnings).toEqual([]);
  });

  it('binds the public MySQL-family driver to SingleStore', () => {
    const client: MysqlQueryable = {
      async execute() {
        return [[], []];
      },
    };
    expect(singlestoreDriver(client).dialect).toBe(singlestore);
  });

  it('refuses MySQL routine declarations and emits SingleStore generated columns', () => {
    expect(() =>
      singlestore.migrations.emitSchemaObject({
        kind: 'create_routine',
        definition: {
          kind: 'function',
          name: 'plus_one',
          params: [{ name: 'value', type: 'integer', mode: 'in' }],
          returns: { type: 'integer' },
          body: 'RETURN value + 1',
        },
      }),
    ).toThrow(UnsupportedFeatureError);
    expect(
      singlestore.migrations.emitSchemaObject({
        kind: 'generated_column',
        definition: {
          name: 'email_key',
          type: 'VARCHAR(255)',
          expression: 'LOWER(email)',
          stored: true,
        },
      }),
    ).toEqual(['`email_key` AS (LOWER(email)) PERSISTED VARCHAR(255)']);
  });

  it('refuses storage-dependent index methods and check constraints before execution', () => {
    for (const method of ['btree', 'hash'] as const) {
      expect(() =>
        singlestore.migrations.emitSchemaObject({
          kind: 'create_index',
          definition: {
            name: `users_email_${method}`,
            table: 'users',
            method,
            columns: ['email'],
          },
        }),
      ).toThrow(
        expect.objectContaining({
          dialect: 'singlestore',
          feature: `index method ${method} without table-storage evidence`,
        }),
      );
    }
    expect(() =>
      singlestore.migrations.emitSchemaObject({
        kind: 'check_constraint',
        table: 'users',
        name: 'users_email_check',
        expression: "email <> ''",
      }),
    ).toThrow('singlestore does not support CHECK constraint');
  });
});
