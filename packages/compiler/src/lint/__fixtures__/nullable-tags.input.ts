import { type Table, type Unique } from '@zmdb/schema/tags';

export interface Account extends Table<'accounts'> {
  email: (string | null) & Unique;
}
