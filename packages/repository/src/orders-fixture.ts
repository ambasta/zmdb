// The `orders` table, and the users → orders relation over it.
//
// Two directories build a users/orders fixture — `dx/` for the quickstart and
// `typed-populate/` for population — and they need different `users` (the
// quickstart's has `email`/`age` to match its sqlite DDL, population's has
// `name`), but the *child* side is the same table with the same foreign key in
// both. That half lives here so the two can disagree about `users` on purpose
// without also keeping two copies of `orders`.
import { defineSchema, integer, serial } from '@zmdb/schema-core';
import { oneToMany } from '@zmdb/schema-core/relations';

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});

/**
 * users → orders. `as const` matters: `defineRepository` and `BaseRepository`'s
 * second type argument infer from this object, and that inference is what makes
 * `populate: ['orders']` typed rather than `string[]`.
 */
export const ordersRelation = {
  meta: oneToMany('orders', 'userId'),
  entity: OrderSchema,
  cardinality: 'one-to-many',
  childTable: 'orders',
  childFk: 'userId',
  parentKey: 'id',
} as const;
