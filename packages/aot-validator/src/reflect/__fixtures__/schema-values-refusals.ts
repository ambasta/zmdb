// A `schemaOf<T>()` that must be refused, and refused by name.
//
// Separate from `schema-values.ts` because that file is asserted to transform *cleanly*,
// and one expected refusal in it would turn the whole spec's "no diagnostics" check into
// a list of exceptions.
//
// The type below is column-for-column a table, minus the one thing a table cannot be
// without: the name to put after `CREATE TABLE`. Guessing `Untagged` from the type name
// is exactly the class of guess `f70186c6` deleted, so the transform leaves the call
// alone and names what it could not read.

import { schemaOf } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql } from '@zmdb/schema-core/tags';

declare function schema(label: string, value: unknown): void;

/** No `Table<'name'>`. */
interface Untagged {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

schema('untagged', schemaOf<Untagged>());
