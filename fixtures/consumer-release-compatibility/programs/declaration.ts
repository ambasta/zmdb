import { schemaOf } from '@zmdb/schema';
import type { Table, Sql, PrimaryKey } from '@zmdb/schema/tags';
export interface Echo extends Table<'echo'> {
  id: number & Sql<'integer'> & PrimaryKey;
  value: string & Sql<'text'>;
}
export const echo = schemaOf<Echo>();
