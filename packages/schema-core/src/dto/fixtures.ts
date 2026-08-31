// The schemas the DTO tests share.
//
// `users` (scalar columns plus an enum) and `orders` (something numeric to
// aggregate over) are all these tests need, and four files had grown their own
// slightly different copy — `order-page.spec.ts`'s `users` had no `role`, so a
// change to how enum columns are derived would have been checked in some of them
// and not others.
import { defineSchema, integer, jsonEnum, numeric, serial, text } from '../index.ts';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});
export type UserS = typeof UserSchema;

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  customerId: integer().notNull(),
  total: numeric().notNull(),
  status: text().notNull(),
});
export type OrderS = typeof OrderSchema;
