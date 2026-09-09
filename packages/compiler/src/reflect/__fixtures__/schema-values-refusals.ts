// A `schemaOf<T>()` that must be refused, and refused by name.
//
// Separate from `schema-values.ts` because that file is asserted to transform *cleanly*,
// and one expected refusal in it would turn the whole spec's "no diagnostics" check into
// a list of exceptions.
//
// An untagged type must be refused because its table name cannot be guessed. A tagged
// keyless table beside it must still emit normally; keyed-operation refusal belongs to
// the repository boundary.

import { schemaOf } from '@zmdb/schema';
import { type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

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
