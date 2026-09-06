// The `orders` table, shared by the fixtures that need a child side.
//
// Two directories build a users/orders fixture — `dx/` for the quickstart and
// `typed-populate/` for population — and they need different `users` (the
// quickstart's has `email`/`age` to match its sqlite DDL, population's has
// `name`), but the *child* side is the same table with the same foreign key in
// both. That half lives here so the two can disagree about `users` on purpose
// without also keeping two copies of `orders`.
//
// There used to be an `ordersRelation` const here as well — the users → orders relation as a
// map entry, for a subclass static and for `defineRepository`. The relation is a property of
// `users`, and each `users` declares it: `orders?: Order[] & OneToMany<'orders', 'userId'>`.
import { schemasFrom } from '@zmdb/compiler/testing';
import type { PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'integer'>;
}

export const { Order: OrderSchema } = schemasFrom<{ Order: Order }>(import.meta.url, ['Order']);
