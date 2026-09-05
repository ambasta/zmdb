import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly email: string & Sql<'text'>;
}
