import { schemasFrom } from '@zmdb/aot-validator/testing';
import { diff, emitUp, snapshot, type ChangeOp, type SchemaSnapshot, type TableSnapshot } from '@zmdb/migrations';
import type { PrimaryKey, References, Rowstore, ShardKey, SortKey, Sql, Table, Unique } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import { createViewDdl, enableRlsDdl } from '../schema-objects/index.js';

export interface Order extends Table<'orders'>, ShardKey<['customerId']>, SortKey<['id']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  customerId: bigint & Sql<'bigint'>;
}

export interface Session extends Table<'sessions'>, Rowstore {
  id: string & Sql<'text'> & PrimaryKey;
  value: string & Sql<'text'>;
}

export interface UniqueUser extends Table<'unique_users'>, ShardKey<['id']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  email: string & Sql<'text'> & Unique;
}

export interface ReferencedOrder extends Table<'referenced_orders'>, ShardKey<['userId']> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  userId: bigint & Sql<'bigint'> & References<'users.id'>;
}

const {
  Order: OrderSchema,
  ReferencedOrder: ReferencedOrderSchema,
  Session: SessionSchema,
  UniqueUser: UniqueUserSchema,
} = schemasFrom<{
  Order: Order;
  ReferencedOrder: ReferencedOrder;
  Session: Session;
  UniqueUser: UniqueUser;
}>(import.meta.url, ['Order', 'ReferencedOrder', 'Session', 'UniqueUser']);

const EMPTY: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

function createTable(table: TableSnapshot): Extract<ChangeOp, { kind: 'create_table' }> {
  return {
    kind: 'create_table',
    table: table.name,
    columns: table.columns,
    primaryKey: table.primaryKey,
    foreignKeys: table.foreignKeys,
    ...(table.tableOptions === undefined ? {} : { tableOptions: table.tableOptions }),
  };
}

function onlyTable(schema: Parameters<typeof snapshot>[0][number]): TableSnapshot {
  const table = snapshot([schema]).tables[0];
  if (table === undefined) throw new Error('expected one table');
  return table;
}

describe('CockroachDB and SingleStore dialect variants', () => {
  it('carries shard and sort keys from a declaration through snapshot and DDL', () => {
    const table = onlyTable(OrderSchema);
    expect(table.tableOptions).toEqual({ shardKey: ['customerId'], sortKey: ['id'] });
    expect(emitUp(createTable(table), 'singlestore')).toBe(
      'CREATE TABLE `orders` (`customerId` BIGINT NOT NULL, `id` BIGINT PRIMARY KEY, ' +
        'SHARD KEY (`customerId`), SORT KEY (`id`))',
    );
  });

  it('emits the explicit SingleStore rowstore alternative', () => {
    const table = onlyTable(SessionSchema);
    expect(table.tableOptions).toEqual({ rowstore: true });
    expect(emitUp(createTable(table), 'singlestore')).toBe(
      'CREATE ROWSTORE TABLE `sessions` (`id` TEXT PRIMARY KEY, `value` TEXT NOT NULL)',
    );
  });

  it('refuses a SingleStore sort key on the explicit rowstore alternative', () => {
    const table = onlyTable(SessionSchema);
    expect(() =>
      emitUp(
        createTable({
          ...table,
          tableOptions: { rowstore: true, sortKey: ['id'] },
        }),
        'singlestore',
      ),
    ).toThrow('cannot declare SORT KEY on explicit ROWSTORE table "sessions"');
  });

  it('refuses a SingleStore table whose storage and distribution were left implicit', () => {
    const table: TableSnapshot = {
      name: 'implicit',
      columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
      primaryKey: ['id'],
      foreignKeys: [],
    };

    expect(() => emitUp(createTable(table), 'singlestore')).toThrowError(UnsupportedFeatureError);
    expect(() => emitUp(createTable(table), 'singlestore')).toThrow('must declare ShardKey<…> or Rowstore');
  });

  it('refuses foreign keys instead of inheriting MySQL constraint DDL', () => {
    const table = onlyTable(ReferencedOrderSchema);
    expect(() => emitUp(createTable(table), 'singlestore')).toThrow('singlestore does not enforce foreign keys');
  });

  it('refuses a unique column whose index cannot include the whole shard key', () => {
    const table = onlyTable(UniqueUserSchema);
    expect(table.columns.find(column => column.name === 'email')?.unique).toBe(true);
    expect(() => emitUp(createTable(table), 'singlestore')).toThrow('cannot enforce UNIQUE on "unique_users"."email"');
  });

  it('refuses a SingleStore table-options change instead of producing an empty diff', () => {
    const before = snapshot([OrderSchema]);
    const table = before.tables[0];
    if (table === undefined) throw new Error('expected an orders table');
    const after: SchemaSnapshot = {
      ...before,
      tables: [{ ...table, tableOptions: { shardKey: ['id'], sortKey: ['id'] } }],
    };

    expect(() => diff(before, after, { dialect: 'singlestore' })).toThrow('create a replacement table');
  });

  it('emits inherited Cockroach DDL explicitly rather than falling through an unknown dialect', () => {
    const table = onlyTable(OrderSchema);
    expect(emitUp(createTable(table), 'cockroach')).toBe(
      'CREATE TABLE "orders" ("customerId" BIGINT NOT NULL, "id" BIGINT PRIMARY KEY)',
    );
    expect(diff(EMPTY, snapshot([OrderSchema]), { dialect: 'cockroach' })).toHaveLength(1);
  });

  it('inherits materialized views but refuses Cockroach row-level security', () => {
    expect(createViewDdl({ name: 'daily_orders', select: 'SELECT 1', materialized: true }, 'cockroach')).toBe(
      'CREATE MATERIALIZED VIEW "daily_orders" AS SELECT 1',
    );
    expect(() => enableRlsDdl('orders', 'cockroach')).toThrowError(UnsupportedFeatureError);
  });
});
