// The schema-*value* derivations: `TsType`, and the `Entity`/`CreateDTO`/`UpdateDTO` branch in
// `./index.ts` that reads a literal column map.
//
// The column map below was `{ id: primaryKey(serial()), email: notNull(text()), … }`. The
// builders are gone, so it is written as a type, which is all these mapped types ever read —
// `defineSchema` inferred `C` from an object literal and the literal is what mattered, not the
// functions that produced it. Written out, the metadata is also easier to check against the
// assertions than a chain of modifiers was.
//
// It is spelled without `readonly` deliberately: the value-side `Entity` is a homomorphic mapped
// type and copies the modifier through, while the tagged one in `./derive` strips it. See the
// same note in `schema-of.type-test.ts`, which covers why nothing in the shipped path reaches
// this branch with literal columns any more.
//
// No runtime code: a compilation gate, run by `yarn typecheck` and therefore by CI.

import type { ColumnMeta, CreateDTO, Entity, Equal, Expect, PrimaryKeyOf, TsType, UpdateDTO } from './index.ts';

type Simplify<T> = { [K in keyof T]: T[K] };

// 1. `TsType` over every member of `SqlType`. One column type maps to one TypeScript type, and
//    this is the whole table — a new `SqlType` with no branch lands on `unknown`, which is a
//    silently wrong row rather than an error, so the totality is worth stating.
type Meta<T extends ColumnMeta['type'], F extends ColumnMeta['flags'] = { nullable: false }> = {
  type: T;
  flags: F;
};

export type _T1 = Expect<Equal<TsType<Meta<'serial'>>, number>>;
export type _T2 = Expect<Equal<TsType<Meta<'integer'>>, number>>;
export type _T3 = Expect<Equal<TsType<Meta<'numeric'>>, number>>;
export type _T4 = Expect<Equal<TsType<Meta<'bigint'>>, bigint>>;
export type _T5 = Expect<Equal<TsType<Meta<'text'>>, string>>;
export type _T6 = Expect<Equal<TsType<Meta<'varchar'>>, string>>;
export type _T7 = Expect<Equal<TsType<Meta<'boolean'>>, boolean>>;
export type _T8 = Expect<Equal<TsType<Meta<'timestamp'>>, Date>>;
export type _T9 = Expect<
  Equal<TsType<Meta<'jsonEnum', { nullable: false; enum: ['admin', 'user'] }>>, 'admin' | 'user'>
>;
// A `jsonEnum` whose members did not reach the metadata degrades to `string` rather than `never`.
export type _T10 = Expect<Equal<TsType<Meta<'jsonEnum'>>, string>>;
// A json column is `unknown` on this side; the payload shape lives on the declared type and on
// `ColumnIR.payload`. `json.type-test.ts` covers where it went.
export type _T11 = Expect<Equal<TsType<Meta<'json'>>, unknown>>;
export type _T12 = Expect<Equal<TsType<Meta<'text', { nullable: true }>>, string | null>>;

// 2. The DTO family, from a column map.
type Columns = {
  id: { type: 'serial'; flags: { nullable: false; primaryKey: true; autoIncrement: true } };
  email: { type: 'text'; flags: { nullable: false } };
  role: { type: 'jsonEnum'; flags: { nullable: false; hasDefault: true; enum: ['admin', 'user'] } };
  age: { type: 'integer'; flags: { nullable: false } };
  createdAt: { type: 'timestamp'; flags: { nullable: false; hasDefault: true } };
  payload: { type: 'json'; flags: { nullable: false } };
  config: { type: 'json'; flags: { nullable: true } };
};
type S = { columns: Columns };

export type _TestEntityId = Expect<Equal<Entity<S>['id'], number>>;
export type _TestEntityEmail = Expect<Equal<Entity<S>['email'], string>>;
export type _TestEntityRole = Expect<Equal<Entity<S>['role'], 'admin' | 'user'>>;
export type _TestEntityAge = Expect<Equal<Entity<S>['age'], number>>;
export type _TestEntityCreatedAt = Expect<Equal<Entity<S>['createdAt'], Date>>;
export type _TestEntityPayload = Expect<Equal<Entity<S>['payload'], unknown>>;
export type _TestEntityConfig = Expect<Equal<Entity<S>['config'], unknown>>;
// The exact key set, not a subset. This is the assertion that catches an erased column map:
// `Record<string, ColumnMeta>` derives `keyof Entity<S>` as `string`, and every per-property
// assertion above still passes.
export type _TestEntityKeys = Expect<
  Equal<keyof Entity<S>, 'id' | 'email' | 'role' | 'age' | 'createdAt' | 'payload' | 'config'>
>;

type _TestCreateDTO = Simplify<CreateDTO<S>>;
export type _TestCreateDTOKeys = Expect<
  Equal<keyof _TestCreateDTO, 'email' | 'age' | 'payload' | 'role' | 'createdAt' | 'config'>
>;
// An auto-increment column is absent from the insert shape, not optional in it — the same
// distinction `Serial` and `HasDefault` draw on the tagged side.
export type _TestCreateDTOId = Expect<Equal<'id' extends keyof _TestCreateDTO ? true : false, false>>;
export type _TestCreateDTORole = Expect<Equal<_TestCreateDTO['role'], 'admin' | 'user' | undefined>>;
export type _TestCreateDTOEmail = Expect<Equal<_TestCreateDTO['email'], string>>;
export type _TestCreateDTOPayload = Expect<Equal<_TestCreateDTO['payload'], unknown>>;
// A nullable column is optional on insert — see `./derive`'s `CreateDTO` — so this carries the
// `| undefined` every optional property of the value-side derivation carries.
export type _TestCreateDTOConfig = Expect<Equal<_TestCreateDTO['config'], unknown>>;

type _TestUpdateDTO = Simplify<UpdateDTO<S>>;
export type _TestUpdateDTOEmail = Expect<Equal<_TestUpdateDTO['email'], string | undefined>>;
export type _TestUpdateDTOPayload = Expect<Equal<_TestUpdateDTO['payload'], unknown>>;
export type _TestUpdateDTOConfig = Expect<Equal<_TestUpdateDTO['config'], unknown>>;
// An explicit `undefined` is accepted under `exactOptionalPropertyTypes`, because the patch
// derivation adds `| undefined` to the value rather than only marking the key optional.
export const _UpdUndefined: UpdateDTO<S> = { email: undefined, role: 'admin' };

// 3. A natural primary key is required on insert: it is the key, but the database does not
//    generate it, so `autoIncrement` is what drops a column and `primaryKey` is not.
type NaturalPkSchema = { columns: { id: { type: 'text'; flags: { nullable: false; primaryKey: true } } } };
export type _TestNaturalPkCreateDTO = Expect<Equal<CreateDTO<NaturalPkSchema>['id'], string>>;
export type _TestNaturalPkOf = Expect<Equal<PrimaryKeyOf<NaturalPkSchema>, string>>;

// A composite key is an object map, a single key is the scalar, and a table declaring none
// resolves to `unknown` rather than `never` — `never` would make every `findById` call an error.
type CompositeSchema = {
  columns: {
    tenantId: { type: 'text'; flags: { nullable: false; primaryKey: true } };
    userId: { type: 'integer'; flags: { nullable: false; primaryKey: true } };
  };
};
export type _TestCompositeKey = Expect<Equal<PrimaryKeyOf<CompositeSchema>, { tenantId: string; userId: number }>>;
export type _TestScalarKey = Expect<Equal<PrimaryKeyOf<S>, number>>;
export type _TestNoKey = Expect<Equal<PrimaryKeyOf<{ columns: { a: Meta<'text'> } }>, unknown>>;
