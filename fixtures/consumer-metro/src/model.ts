import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/core/tags';

export interface User extends Table<'users'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly email: string & Sql<'text'>;
}
