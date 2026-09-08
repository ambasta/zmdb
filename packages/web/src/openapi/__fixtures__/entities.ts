// The entity the route documents are derived from. A separate file so `route-schemas.ts`
// contains nothing but imports and the one call the spec evaluates.

import {
  type HasDefault,
  type Length,
  type PrimaryKey,
  type Sensitive,
  type Serial,
  type Sql,
  type Table,
} from '@zmdb/schema/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
}
