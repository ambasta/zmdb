// The entity the route documents are derived from. A separate file so `route-schemas.ts`
// contains nothing but imports and the one call the spec evaluates.

import type { HasDefault, Length, PrimaryKey, Sensitive, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
}
