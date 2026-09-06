// A `schemaOf<T>()` that must be refused, and refused by name.
//
// Separate from `schema-values.ts` because that file is asserted to transform *cleanly*,
// and one expected refusal in it would turn the whole spec's "no diagnostics" check into
// a list of exceptions.
//
// Two types, each column-for-column a table minus one thing a table cannot be without.
//
// `Untagged` has no name to put after `CREATE TABLE`. Guessing `Untagged` from the type name
// is exactly the class of guess `f70186c6` deleted, so the transform leaves the call alone and
// names what it could not read.
//
// `Ledger` has no primary key. `defineSchema` threw a `SchemaError` on that and the reason
// survives the function: `findById`, `update` and `delete` compile their `WHERE` out of the
// primary key, so an empty one is a `DELETE FROM ledger` for a call that asked to remove one
// row. It is a build error now rather than a constructor throw, which is strictly earlier.

import { schemaOf } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

declare function schema(label: string, value: unknown): void;

/** No `Table<'name'>`. */
interface Untagged {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

/** Named, but with no `PrimaryKey` on any column. */
interface Ledger extends Table<'ledger'> {
  entry: string & Sql<'text'>;
  amount: number & Sql<'integer'>;
}

schema('untagged', schemaOf<Untagged>());
schema('ledger', schemaOf<Ledger>());
