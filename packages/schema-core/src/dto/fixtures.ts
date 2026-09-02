// The schemas the DTO tests share.
//
// `User` (scalar columns plus an enum) and `Order` (something numeric to aggregate
// over) are all these tests need, and four files had grown their own slightly
// different copy — `order-page.spec.ts`'s users had no `role`, so a change to how
// enum columns are derived would have been checked in some of them and not others.
//
// The declaration is the interface; the schema values below are read off it the way a
// build would. See `@zmdb/aot-validator/testing`.
import { schemasFrom } from '@zmdb/aot-validator/testing';

import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  role: 'admin' | 'user';
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  customerId: number & Sql<'integer'>;
  total: number & Sql<'numeric'>;
  status: string & Sql<'text'>;
}

export const { User: UserSchema, Order: OrderSchema } = schemasFrom<{ User: User; Order: Order }>(import.meta.url, [
  'User',
  'Order',
]);
