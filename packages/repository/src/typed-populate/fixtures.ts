// Schemas and relation maps shared by the typed-populate files.
//
// Four files exercise the same shape: two `.spec.ts` over in-memory sqlite, and
// two `.type-test.ts` that are a compilation gate run by `yarn typecheck`. They
// only stay tests of the same claim if they agree about the shape, so the shape
// lives here once instead of four times.
import { defineSchema, integer, serial, text } from '@zmdb/schema-core';
import { manyToOne } from '@zmdb/schema-core/relations';

import { OrderSchema, ordersRelation } from '../orders-fixture.ts';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
});

export { OrderSchema };

export const ProfileSchema = defineSchema('profiles', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  bio: text().notNull(),
});

const profileRelation = {
  meta: manyToOne('profiles', 'userId'),
  entity: ProfileSchema,
  cardinality: 'many-to-one',
  childTable: 'profiles',
  childFk: 'userId',
  parentKey: 'id',
} as const;

/**
 * users → orders. Kept as a const rather than written inline in a class body: a
 * class cannot refer to its own statics in its own `extends` clause, and
 * `BaseRepository`'s second type argument is what makes `populate` typed.
 */
export const userRelations = { orders: ordersRelation } as const;

/** users → orders and users → profile, for the files that need a to-one too. */
export const userJoinRelations = { orders: ordersRelation, profile: profileRelation } as const;

/** orders → user, the inverse of `userRelations.orders`. */
export const orderRelations = {
  user: {
    meta: manyToOne('users', 'userId'),
    entity: UserSchema,
    cardinality: 'many-to-one',
    childTable: 'users',
    childFk: 'id',
    parentKey: 'userId',
  },
} as const;
