import type { PrimaryKey, Sensitive, Serial, Sql, Table } from '@zmdb/schema-core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface PrivateUser extends Table<'private_users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  secret: string & Sql<'text'> & Sensitive;
}
