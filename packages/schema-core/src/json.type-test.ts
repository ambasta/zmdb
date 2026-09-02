// A json column's payload shape, and what each half of the codebase does with it.
//
// This file used to be written with `json<UserMetadata>()`, whose return type hung the payload
// on a `__payload` phantom so a mapped type over the column map could read it back. That builder
// is gone, and so is the phantom — `columnMetaFromIR` cannot set it, because a payload shape is
// a type and a `ColumnMeta` is data — and so is the mapped type: a row's shape now comes from
// the declared type, where the payload never had to be smuggled in the first place.
//
// The shape did not go anywhere, it moved. The back-ends read `ColumnIR.payload` (see
// `ir/ir.spec.ts`, and `repository/src/tagged-to-ddl.spec.ts` for a `create` call that a wrong
// payload now fails), and the derivations read the declared type, which is what this file tests.
// That is strictly more than the builder could say: `json<UserMetadata>()` gave the payload to
// the TypeScript side only, and the emitted validator never saw it.
//
// No runtime code: a compilation gate, run by `yarn typecheck` and therefore by CI.

import type { CreateDTO, Entity, UpdateDTO } from './derive/index.ts';
import type { Equal, Expect } from './index.ts';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from './tags/index.ts';

interface UserMetadata {
  preferences: { theme: 'light' | 'dark' };
  tags: string[];
}

interface JsonRow extends Table<'json_rows'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  meta: UserMetadata & Sql<'json'>;
  nullableMeta: (UserMetadata & Sql<'json'>) | null;
  defaultMeta: UserMetadata & Sql<'json'> & HasDefault;
}

// 1. The payload survives every derivation, tags and all — `Entity<T>` keeps the tags on
//    purpose, so that `Omit` and `Partial` downstream cannot strip a constraint.
export type _E1 = Expect<Equal<Entity<JsonRow>['meta'], UserMetadata & Sql<'json'>>>;
export type _E2 = Expect<Equal<Entity<JsonRow>['nullableMeta'], (UserMetadata & Sql<'json'>) | null>>;

// 2. And it is readable *through* the intersection, which is the property handler code depends
//    on. A tag is an optional unique-symbol slot, so the intersection is the payload plus
//    nothing, and both directions of assignment hold.
export type _E3 = Expect<Equal<Entity<JsonRow>['meta']['preferences']['theme'], 'light' | 'dark'>>;
declare const row: Entity<JsonRow>;
export const _plain: UserMetadata = row.meta;
export const _tagged: Entity<JsonRow>['meta'] = { preferences: { theme: 'light' }, tags: [] };

// 3. A json column with no payload type has no useful tagged spelling, and the assertion below
//    is why: `unknown & T` reduces to `T`, so the column's type becomes the tag — an all-optional
//    symbol slot, which no data value has anything in common with. `json()` with no argument was
//    expressible and this is not; a column holding arbitrary JSON has to name an open shape
//    (`Record<string, unknown>`) instead of declining to name one.
export type _E4 = Expect<Equal<unknown & Sql<'json'>, Sql<'json'>>>;

// 4. Insert and patch shapes treat a json column like any other: required unless it is nullable
//    or defaulted. Nothing about the payload changes this, and a regression here would show up as
//    a payload silently becoming optional.
export type _C1 = Expect<Equal<Extract<keyof CreateDTO<JsonRow>, 'meta'>, 'meta'>>;
export type _C2 = Expect<Equal<CreateDTO<JsonRow> extends { meta: unknown } ? true : false, true>>;
export type _C3 = Expect<Equal<CreateDTO<JsonRow> extends { nullableMeta: unknown } ? true : false, false>>;
export type _C4 = Expect<Equal<CreateDTO<JsonRow> extends { defaultMeta: unknown } ? true : false, false>>;
export type _C5 = Expect<Equal<'id' extends keyof CreateDTO<JsonRow> ? true : false, false>>;

export type _U1 = Expect<Equal<UpdateDTO<JsonRow> extends { meta: unknown } ? true : false, false>>;
export type _U2 = Expect<Equal<Required<UpdateDTO<JsonRow>>['meta'], UserMetadata & Sql<'json'>>>;
