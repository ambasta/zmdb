// Schemas, repositories and the recording driver the typed-methods files share.
//
// Six files here exercise the same three schemas — one with a single-column
// primary key, one with a composite key, one plain — across runtime specs and
// `.type-test.ts` compilation gates. They had a copy each, which is how a "typed
// reads" schema and a "typed writes" schema end up quietly disagreeing about
// whether `role` has a default, and with it whether it is optional on create.
import { defineSchema, integer, jsonEnum, primaryKey, serial, text } from '@zmdb/schema-core';

import { BaseRepository, type Driver } from '../index.ts';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});
export type S = typeof UserSchema;

/** Two primary-key columns, so `findById` takes an object rather than a scalar. */
export const CompositeSchema = defineSchema('tenant_users', {
  tenantId: primaryKey(text()),
  userId: primaryKey(integer()),
  role: text().notNull(),
});
export type CompositeS = typeof CompositeSchema;

export const SinglePkSchema = defineSchema('products', {
  id: primaryKey(integer()),
  name: text().notNull(),
});
export type SingleS = typeof SinglePkSchema;

export class Users extends BaseRepository<S> {
  static override readonly schema = UserSchema;
}

export class TenantUsersRepo extends BaseRepository<CompositeS> {
  static override readonly schema = CompositeSchema;
}

export class ProductsRepo extends BaseRepository<SingleS> {
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
    execute: async q => (calls.push({ text: q.text, parameters: q.parameters }), rows),
  };
  return { driver, calls };
}
