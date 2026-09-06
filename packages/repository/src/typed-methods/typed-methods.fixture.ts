// Schemas, repositories and the recording driver the typed-methods tests share.
//
// Six files here exercise the same three schemas — one with a single-column
// primary key, one with a composite key, one plain — across runtime specs and
// `.type-test.ts` compilation gates. They had a copy each, which is how a "typed
// reads" schema and a "typed writes" schema end up quietly disagreeing about
// whether `role` has a default, and with it whether it is optional on create.
import { schemasFrom } from '@zmdb/compiler/testing';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

import { BaseRepository, type Driver } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  role: ('admin' | 'user') & HasDefault;
}

/** Two primary-key columns, so `findById` takes an object rather than a scalar. */
export interface TenantUser extends Table<'tenant_users'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  userId: number & Sql<'integer'> & PrimaryKey;
  role: string & Sql<'text'>;
}

export interface Product extends Table<'products'> {
  id: number & Sql<'integer'> & PrimaryKey;
  name: string & Sql<'text'>;
}

export const {
  User: UserSchema,
  TenantUser: CompositeSchema,
  Product: SinglePkSchema,
} = schemasFrom<{ User: User; TenantUser: TenantUser; Product: Product }>(import.meta.url, [
  'User',
  'TenantUser',
  'Product',
]);

export class Users extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

export class TenantUsersRepo extends BaseRepository<TenantUser> {
  static override readonly schema = CompositeSchema;
}

export class ProductsRepo extends BaseRepository<Product> {
  static override readonly schema = SinglePkSchema;
}

export interface Recorder {
  readonly driver: Driver;
  /** Every query the repository compiled, in order — the SQL is what these specs assert on. */
  readonly calls: { text: string; parameters: readonly unknown[] }[];
}

/** A driver that records the queries it is handed and answers every one with `rows`. */
export function recorder(rows: Record<string, unknown>[] = []): Recorder {
  const calls: { text: string; parameters: readonly unknown[] }[] = [];
  const driver: Driver = {
    dialect: postgresDialect,
    execute: async q => (calls.push({ text: q.text, parameters: q.parameters }), rows),
  };
  return { driver, calls };
}
