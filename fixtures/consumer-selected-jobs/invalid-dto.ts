import type { CreateDTO, PrimaryKey, Sql, Table } from 'zmdb';

interface Order extends Table<'orders'> {
  readonly id: number & Sql<'integer'> & PrimaryKey;
  readonly name: string & Sql<'text'>;
}

export const invalid: CreateDTO<Order> = { id: 'wrong', name: 'order' };
