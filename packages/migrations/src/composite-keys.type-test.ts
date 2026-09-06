// The key on the snapshot, as a type. These assertions pin the frozen contract from
// `./SPEC.md` §1.1 and §1.3.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { ChangeOp, ColumnSnapshot, SnapshotableSchema, TableSnapshot } from './index.js';

// ---------------------------------------------------------------------------
// §1.1 `TableSnapshot.primaryKey`, required
// ---------------------------------------------------------------------------

// The list is not optional. An absent field would make "old snapshot, key unknown" and "table
// with no key" the same value, and the diff would have to guess which — so `[]` is the only
// spelling of "no key" and the field is always there.
//
export type _KeyOnTable = Expect<Equal<TableSnapshot['primaryKey'], readonly string[]>>;

// And the ordering rule, which is a fact about the *value* rather than the type — stated here
// because it is the reason the field is a list rather than a set, and the type is where a
// reader looks for the shape. `readonly string[]`, not `ReadonlySet<string>`: `['a','b']` and
// `['b','a']` are two different keys.
//
export type _KeyIsOrdered = Expect<Equal<TableSnapshot['primaryKey'][number], string>>;

// The per-column flag stays. `columnDdl` reads it, and §1.1 keeps it for exactly that: it is a
// projection of the list, never the record of it. This one holds today and must keep holding.
export type _ColumnFlagStays = Expect<Equal<ColumnSnapshot['primaryKey'], boolean>>;

// ---------------------------------------------------------------------------
// §1.3 `alter_primary_key`
// ---------------------------------------------------------------------------

/** The op §1.3 freezes, as the union arm it becomes. */
interface AlterPrimaryKey {
  readonly kind: 'alter_primary_key';
  readonly table: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

export type _AlterKeyIsAnOp = Expect<Equal<Extract<ChangeOp, { kind: 'alter_primary_key' }>, AlterPrimaryKey>>;

// `create_table` carries the key in its own payload and never produces a companion
// `alter_primary_key` — so the payload needs somewhere to put it.
//
/** The `create_table` payload, named so the assertion below fits on one line. */
type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

export type _CreateTableCarriesKey = Expect<Equal<CreateTable['primaryKey'], readonly string[]>>;

// ---------------------------------------------------------------------------
// The input side, which §1.1 does not mention
// ---------------------------------------------------------------------------

// `snapshot(schemas)` takes a `SnapshotableSchema`, and that type describes a table by its
// name and a record of per-column flags. There is nowhere in it to say what the key is, so
// widening `TableSnapshot` alone leaves `snapshot` with two ways to fill the new field: filter
// the columns on the flag, which `schema-core/src/ir/SPEC.md` §4.1 forbids by name, or read a
// field that does not exist. A `CoreSchema` — the only value ever passed here — already
// carries `primaryKey: readonly string[]`, so the input type has to name it and nothing at any
// call site changes. Recorded as a type assertion because it is a gap in the frozen spec, not
// a gap in the code.
//
export type _InputCarriesKey = Expect<Equal<SnapshotableSchema['primaryKey'], readonly string[]>>;
