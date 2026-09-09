import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}
