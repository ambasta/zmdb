// The two schemas the relation tests point at.
//
// `users` is the target every foreign key in these tests references, and
// `profiles` is the to-one side. Both the runtime spec and the `.type-test.ts`
// compilation gate need them, and they only test the same claim while they agree
// about the shape.
import { defineSchema, integer, serial, text } from '../index.ts';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

export const ProfileSchema = defineSchema('profiles', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  bio: text(),
});
