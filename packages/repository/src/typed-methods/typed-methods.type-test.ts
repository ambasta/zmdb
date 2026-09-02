// Type-level tests for the typed repository methods (#203, #206). No runtime
// code: this file is a *compilation* gate run by `yarn typecheck`, and therefore
// by CI.
//
// These assertions used to live in `it('type-level: …')` blocks in the sibling
// `.spec.ts` files as `expectTypeOf(...)` calls, which are runtime no-ops — and
// the package tsconfig excluded `**/*.spec.ts`, so nothing compiled them either.
// A repository whose methods had degraded to `Record<string, unknown>` would have
// passed the suite green.
import type { CreateDTO, Entity, Equal, Expect, Mutual, UpdateDTO } from '@zmdb/schema-core';
import type { ListResult, WhereDTO } from '@zmdb/schema-core/dto';

import type { User, Users } from './fixtures.ts';

declare const repo: Users;

// --- reads (#203) ----------------------------------------------------------
export type _Read1 = Expect<Equal<Awaited<ReturnType<Users['findAll']>>, readonly Entity<User>[]>>;
export type _Read2 = Expect<Equal<Parameters<Users['findOne']>[0], WhereDTO<User>>>;
export type _Read3 = Expect<Equal<Awaited<ReturnType<Users['findOne']>>, Entity<User> | undefined>>;
export type _Read4 = Expect<Equal<Awaited<ReturnType<Users['list']>>, ListResult<Entity<User>>>>;
// `findById`/`find` are overloaded (the second overload takes `populate`), so
// their types cannot be probed with `ReturnType` — that resolves to the last
// overload regardless of arguments. Assert at the value level instead, which
// picks the overload by argument list exactly as a caller does.
export const _readById: Promise<Entity<User> | undefined> = repo.findById(1);
export const _readWhere: Promise<readonly Entity<User>[]> = repo.find({
  role: 'admin',
});
// This repository declares no relations, so there is nothing to populate.
// @ts-expect-error — populate keys are `keyof R`, and `R` is empty here.
export const _readByIdPopulated = repo.findById(1, { populate: ['orders'] });

// The element type is the derived entity, not `Record<string, unknown>`: this is
// what makes `row.role` a `'admin' | 'user'` at the call site. `Mutual`, because the
// enum column carries its tags through the derivation and so is not invariantly equal
// to the bare union — the point of the assertion is that a caller can branch on it.
export type _Read7 = Expect<Mutual<Awaited<ReturnType<Users['findAll']>>[number]['role'], 'admin' | 'user'>>;

// --- writes (#206) ---------------------------------------------------------
export type _Write1 = Expect<Equal<Parameters<Users['create']>[0], CreateDTO<User>>>;
export type _Write2 = Expect<Equal<Awaited<ReturnType<Users['create']>>, Entity<User>>>;
export type _Write3 = Expect<Equal<Parameters<Users['update']>[1], UpdateDTO<User>>>;
export type _Write4 = Expect<Equal<Awaited<ReturnType<Users['update']>>, Entity<User> | undefined>>;
export type _Write5 = Expect<Equal<Awaited<ReturnType<Users['delete']>>, boolean>>;

// `role` has a default ⇒ optional in the create DTO; `email`/`age` do not ⇒
// required. A create literal missing `age` is a compile error, which is the
// runtime `ValidationError` test's static counterpart.
export const _createDto: CreateDTO<User> = { email: 'a@b.com', age: 30 };
// @ts-expect-error — `age` is required (notNull, no default).
export const _createMissingRequired: CreateDTO<User> = { email: 'a@b.com' };
export const _createBadEnum: CreateDTO<User> = {
  email: 'a@b.com',
  age: 30,
  // @ts-expect-error — `role` is a jsonEnum, so only its members are accepted.
  role: 'nope',
};

// `withTransaction` returns the *same* repository type (polymorphic `this`), so
// a tx-scoped repo keeps every derived method signature.
export type _Tx1 = Expect<Equal<ReturnType<Users['withTransaction']>, Users>>;
