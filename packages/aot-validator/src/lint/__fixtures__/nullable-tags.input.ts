import type { Table, Unique } from '@zmdb/schema-core/tags';

export interface Account extends Table<'accounts'> {
  email: (string | null) & Unique;
}
