import { type PrimaryKey, type Sensitive, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface PrivateUser extends Table<'private_users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  secret: string & Sql<'text'> & Sensitive;
}
