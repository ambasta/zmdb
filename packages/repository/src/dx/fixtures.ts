// The quickstart's schemas and relation map.
//
// `quickstart-e2e.spec.ts` runs them against in-memory sqlite and
// `quickstart.type-test.ts` asserts what `defineRepository` derives from them.
// Both are claims about the same wiring, so they read it from one place.
import { defineSchema, integer, serial, text } from '@zmdb/schema-core';
import { oneToMany } from '@zmdb/schema-core/relations';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});

/**
 * users → orders. `as const` matters: `defineRepository` infers its `R` from this
 * object, and that inference is what makes `populate: ['orders']` typed.
 */
export const userRelations = {
  orders: {
    meta: oneToMany('orders', 'userId'),
    entity: OrderSchema,
    cardinality: 'one-to-many',
    childTable: 'orders',
    childFk: 'userId',
    parentKey: 'id',
  },
} as const;
