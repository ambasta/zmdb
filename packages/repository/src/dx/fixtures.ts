// The quickstart's schemas and relation map.
//
// `quickstart-e2e.spec.ts` runs them against in-memory sqlite and
// `quickstart.type-test.ts` asserts what `defineRepository` derives from them.
// Both are claims about the same wiring, so they read it from one place.
import { defineSchema, integer, serial, text } from '@zmdb/schema-core';

import { OrderSchema, ordersRelation } from '../orders-fixture.ts';

// `email` and `age` are here because `quickstart-e2e.spec.ts` creates the table
// with them; the population fixtures' `users` is deliberately a different shape.
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});

export { OrderSchema };

export const userRelations = { orders: ordersRelation } as const;
