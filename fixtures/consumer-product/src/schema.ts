import type { MinLength, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly name: string & Sql<'text'> & MinLength<1>;
}
