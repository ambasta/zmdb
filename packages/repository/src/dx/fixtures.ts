// The quickstart's schemas and relation map.
//
// `quickstart-e2e.spec.ts` runs them against in-memory sqlite and
// `quickstart.type-test.ts` asserts what `defineRepository` derives from them.
// Both are claims about the same wiring, so they read it from one place.
import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

import { OrderSchema, ordersRelation } from '../orders-fixture.ts';

// `email` and `age` are here because `quickstart-e2e.spec.ts` creates the table
// with them; the population fixtures' `users` is deliberately a different shape.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
}

export const { User: UserSchema } = schemasFrom<{ User: User }>(import.meta.url, ['User']);

export { OrderSchema };

export const userRelations = { orders: ordersRelation } as const;
