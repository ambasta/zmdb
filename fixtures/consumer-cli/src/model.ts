// The whole declaration of an order: one interface, plus tags for the facts TypeScript has
// no way to say.
//
// Nothing else in this project describes an order. There is no schema object, no validator,
// no JSON Schema document and no DTO written by hand — `./orders.ts` derives all of them
// from this file, and the build turns each derivation into straight-line JavaScript.
//
// Every tag is an optional `unique symbol` slot, so none of them survives into the output.
// `Sql<'integer'>` is the one to read twice: `integer`, `bigint` and `numeric` are all
// `number` in TypeScript, so the column type is a fact only the declaration can carry.

import type { Length, Min, MinLength, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface Address {
  readonly line1: string & MinLength<1>;
  readonly city: string;
  readonly postcode: string;
}

export interface Order extends Table<'order'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly reference: string & Sql<'varchar'> & Length<32> & MinLength<6> & Unique;
  readonly total: number & Sql<'integer'> & Min<0>;
  readonly status: 'pending' | 'shipped' | 'cancelled';
  readonly note: (string & Sql<'text'>) | null;
  readonly shipTo: Address & Sql<'json'>;
}
