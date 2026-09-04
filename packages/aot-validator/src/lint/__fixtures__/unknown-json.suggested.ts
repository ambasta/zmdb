import type { Sql, Table } from '@zmdb/schema-core/tags';

export interface Account extends Table<'accounts'> {
  preferences: object & Sql<'json'>;
}
