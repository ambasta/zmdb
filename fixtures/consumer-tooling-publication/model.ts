import type { PrimaryKey, Sql, Table } from '@zmdb/schema/tags';

export interface PublicationUser extends Table<'publication_users'> {
  readonly id: number & Sql<'integer'> & PrimaryKey;
  readonly email: string & Sql<'text'>;
}
