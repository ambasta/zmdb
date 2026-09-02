// The four shapes the published OpenAPI document describes, and their schema values.
//
// TypeScript rather than `.mjs` because the declaration *is* the interface now: there is no
// `defineSchema` to call from JavaScript any more, and `openapi-spec.mjs` next door only ever
// wanted the schema values. It imports them from here, which Node loads directly — `.ts` is
// stripped, not compiled, so `node docs-site/build.mjs` still needs no build step.
//
// The document these produce is an artifact CI publishes, so every column here is carrying
// its weight: a default, a nullable column with a bound, a string with both length bounds, a
// pattern, a `numeric`, two enums and a foreign key. Between them they cover every part of
// the OpenAPI mapping that could regress silently.
//
// `schemasFrom` opens a compiler session to read these declarations, which is what a docs
// build can afford and an application should not — see `fixtures/consumer-cli` for the build
// that inlines the same schema instead.

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type {
  HasDefault,
  MaxLength,
  Min,
  MinLength,
  Pattern,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
} from '@zmdb/schema-core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  // No `Sql<...>`: a literal union with nothing overriding it reflects as `jsonEnum`, which
  // is what puts `enum: ["admin", "user"]` in the published document. Naming `Sql<'text'>` here
  // would be a column that stores the same bytes and documents none of the constraint.
  role: ('admin' | 'user') & HasDefault;
  age: (number & Sql<'integer'> & Min<0>) | null;
}

export interface Product extends Table<'products'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'> & MinLength<1> & MaxLength<100>;
  price: number & Sql<'numeric'> & Min<0>;
  code: string & Sql<'text'> & Pattern<'^[A-Z]{3}$'>;
  status: 'active' | 'inactive';
}

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  avatar: string & Sql<'text'>;
  bio: (string & Sql<'text'>) | null;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}

// One call: opening the project is what costs, and a second interface off the open session is
// a few milliseconds.
export const {
  User: UserSchema,
  Product: ProductSchema,
  Profile: ProfileSchema,
  Order: OrderSchema,
} = schemasFrom<{ User: User; Product: Product; Profile: Profile; Order: Order }>(import.meta.url, [
  'User',
  'Product',
  'Profile',
  'Order',
]);
