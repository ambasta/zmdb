import { type Sql, type Table } from '@zmdb/schema/tags';

export interface Account extends Table<'accounts'> {
  preferences: unknown & Sql<'json'>;
}
