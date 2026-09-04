// Plan D5 — what a duplicate install actually does, pinned down so it cannot be
// discovered again by a user. A compilation gate; no runtime code.
//
// A tag is `declare const zmdbSerial: unique symbol`, whose identity is nominal.
// Two copies of this package therefore produce two non-matching tags even though
// their source text is identical. `__fixtures__/duplicate-copy.ts` is that second
// copy.
//
// The failure is not a type error at the tag, and not a type error at the filter.
// The filter resolves to `never`, `Omit<T, never>` is `T`, and so a
// database-generated column stops being omitted from `CreateDTO` and starts being
// *required*. The symptom lands at every `create()` call site as a missing
// property, pointing at the DTO rather than at the duplicate install.
//
// Which is why every assertion in this file is `Equal`, never assignability:
// `never` is assignable to anything, so an assignability check reports success on
// a completely broken filter. The first probe written for D5 did exactly that.

import type { CreateDTO, SerialKeys } from '../derive/index.js';
import type { Equal, Expect } from '../index.js';
import type { Serial as CopiedSerial } from './__fixtures__/duplicate-copy.js';
import type { PrimaryKey, Serial, Sql, Table } from './index.js';

// The control: a type tagged with this package's own `Serial`.
interface Sound extends Table<'sounds'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

// The broken case: the same declaration, tagged from the second copy.
interface Duplicated extends Table<'sounds'> {
  id: number & Sql<'integer'> & CopiedSerial & PrimaryKey;
  email: string & Sql<'text'>;
}

// --- the two tags are not the same type ------------------------------------
export type _D1 = Expect<Equal<Equal<Serial, CopiedSerial>, false>>;

// --- the control behaves ---------------------------------------------------
export type _D2 = Expect<Equal<SerialKeys<Sound>, 'id'>>;
export type _D3 = Expect<Equal<'id' extends keyof CreateDTO<Sound> ? true : false, false>>;

// --- the duplicate does not, and this is exactly how ----------------------
// The filter collapses to `never`...
export type _D4 = Expect<Equal<SerialKeys<Duplicated>, never>>;
// ...so `Omit<T, never>` is `T` and the generated `id` becomes required on
// insert. If a future change to the tag encoding makes cross-copy matching work,
// this assertion is what will fail, and the fix is to delete it and the fixture.
export type _D5 = Expect<Equal<'id' extends keyof CreateDTO<Duplicated> ? true : false, true>>;

// The trap, recorded so nobody re-lays it: this passes on the broken type, because
// `never` is assignable to `'id'`. It asserts nothing.
export type _D6_asserts_nothing = SerialKeys<Duplicated> extends 'id' ? true : false;
export type _D7 = Expect<Equal<_D6_asserts_nothing, true>>;
