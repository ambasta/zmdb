// The key on the snapshot, as a type. Tests freeze for the epic "Composite primary keys and
// expression indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §1.1 and §1.3.
//
// This is the type-level half of `composite-keys.spec.ts`, and it needs the same trick that
// file needs for a different reason: a `.type-test.ts` is compiled by
// `node scripts/typecheck.mjs`, so an assertion about a type that is not true yet is a *build
// failure*, not a red test. `it.fails` has no type-level equivalent.
//
// `@ts-expect-error` is the equivalent, and it has exactly the property that makes `it.fails`
// worth using: it is self-retiring. The frozen claim is written as
// `Expect<Equal<…, frozen shape>>`, which is a TS2344 today because the shape disagrees; the
// directive absorbs it and the gate stays green. The day the type widens the claim holds, the
// directive has nothing to absorb, and TypeScript reports TS2578 "unused '@ts-expect-error'
// directive" — so the implementation slice cannot land without coming back here. A plain
// comment saying "this will be true later" has none of that.
//
// The directive goes on the line TypeScript reports the error on, which is not always the
// declaration. Compiled to find out: for a missing required property, or for any error inside a
// single-line initialiser, it is the declaration line; for a wrong property type inside a
// multi-line object literal, or for a property access inside a multi-line generic argument, it
// is that inner line. Every assertion below is written on one line for that reason, so the
// directive above it is unambiguously the line the compiler points at.
//
// One thing this idiom cannot express, established by compiling it: "this literal stops being
// legal". A snapshot literal with no key list is valid today, so a `@ts-expect-error` over it is
// TS2578 *now* and fails the build immediately. The claim is instead carried positively by
// `_KeyOnTable` below, whose `Equal` fails for `readonly string[] | undefined` and therefore
// pins "required" as well as the element type.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { ChangeOp, ColumnSnapshot, SnapshotableSchema, TableSnapshot } from './index.js';

// ---------------------------------------------------------------------------
// §1.1 `TableSnapshot.primaryKey`, required
// ---------------------------------------------------------------------------

// The list is not optional. An absent field would make "old snapshot, key unknown" and "table
// with no key" the same value, and the diff would have to guess which — so `[]` is the only
// spelling of "no key" and the field is always there.
//
// @ts-expect-error frozen (SPEC.md 1.1): TableSnapshot gains a required `primaryKey`.
export type _KeyOnTable = Expect<Equal<TableSnapshot['primaryKey'], readonly string[]>>;

// And the ordering rule, which is a fact about the *value* rather than the type — stated here
// because it is the reason the field is a list rather than a set, and the type is where a
// reader looks for the shape. `readonly string[]`, not `ReadonlySet<string>`: `['a','b']` and
// `['b','a']` are two different keys.
//
// @ts-expect-error frozen (SPEC.md 1.1): the key is a list, so it is indexable.
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

// @ts-expect-error frozen (SPEC.md 1.3): `ChangeOp` gains an `alter_primary_key` arm.
export type _AlterKeyIsAnOp = Expect<Equal<Extract<ChangeOp, { kind: 'alter_primary_key' }>, AlterPrimaryKey>>;

// `create_table` carries the key in its own payload and never produces a companion
// `alter_primary_key` — so the payload needs somewhere to put it.
//
/** Today's `create_table` payload, named so the assertion below fits on one line. */
type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

// @ts-expect-error frozen (SPEC.md 1.3): the `create_table` payload carries the key.
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
// @ts-expect-error frozen (SPEC.md 1.1, extended): the snapshot input has to carry the key too.
export type _InputCarriesKey = Expect<Equal<SnapshotableSchema['primaryKey'], readonly string[]>>;
