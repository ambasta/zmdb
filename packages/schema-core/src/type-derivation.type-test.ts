// Type-level tests for the derived-type family (#14) — Entity / CreateDTO /
// UpdateDTO. No runtime code: this file is a *compilation* gate run by
// `yarn typecheck`, and therefore by CI.
//
// These assertions used to live in `it('…')` blocks in `type-derivation.spec.ts`
// against a hand-written `{ columns }` shape, where `expectTypeOf` is a runtime
// no-op and the package tsconfig excludes `**/*.spec.ts`. Nothing checked them —
// which is how `defineSchema` came to erase its column map (returning
// `CoreSchema<T>` with `columns: Record<string, ColumnMeta>`) without a single
// failing test. They are asserted here against `defineSchema` itself, i.e. the
// path every consumer actually takes.
import type { CreateDTO, Entity, Equal, Expect, UpdateDTO } from './index.ts';
import {
  defaultTo,
  defineSchema,
  integer,
  jsonEnum,
  notNull,
  numeric,
  primaryKey,
  serial,
  text,
  timestamp,
} from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).defaultTo('user'),
  age: integer(),
  score: numeric().nullable(),
  createdAt: timestamp().defaultTo('now'),
});
type S = typeof UserSchema;

// --- Entity ----------------------------------------------------------------
export type _Ent1 = Expect<Equal<Entity<S>['id'], number>>;
export type _Ent2 = Expect<Equal<Entity<S>['email'], string>>;
export type _Ent3 = Expect<Equal<Entity<S>['role'], 'admin' | 'user'>>;
export type _Ent4 = Expect<Equal<Entity<S>['age'], number>>;
export type _Ent5 = Expect<Equal<Entity<S>['createdAt'], Date>>;
// `.nullable()` widens the column, and only that column.
export type _Ent6 = Expect<Equal<Entity<S>['score'], number | null>>;
export type _Ent7 = Expect<Equal<keyof Entity<S>, 'id' | 'email' | 'role' | 'age' | 'score' | 'createdAt'>>;

// --- CreateDTO -------------------------------------------------------------
// `id` is autoIncrement ⇒ absent entirely (not optional).
export type _Cre1 = Expect<Equal<keyof CreateDTO<S>, 'email' | 'age' | 'score' | 'role' | 'createdAt'>>;
// hasDefault ⇒ optional.
export type _Cre2 = Expect<Equal<CreateDTO<S>['role'], 'admin' | 'user' | undefined>>;
export type _Cre3 = Expect<Equal<CreateDTO<S>['createdAt'], Date | undefined>>;
// no default, not autoIncrement ⇒ required.
export type _Cre4 = Expect<Equal<CreateDTO<S>['email'], string>>;

// --- UpdateDTO -------------------------------------------------------------
export type _Upd1 = Expect<Equal<UpdateDTO<S>['email'], string | undefined>>;
export type _Upd2 = Expect<Equal<UpdateDTO<S>['role'], 'admin' | 'user' | undefined>>;
export const _UpdUndefined: UpdateDTO<S> = { email: undefined, role: 'admin' };

// --- The two modifier styles agree ----------------------------------------
// Function-style modifiers (`primaryKey(serial())`) and fluent modifiers
// (`serial().primaryKey()`) must derive identical types, or the docs teach one
// path and the types only work on the other.
const FnStyleSchema = defineSchema('users', {
  id: primaryKey(serial()),
  email: notNull(text()),
  role: defaultTo(jsonEnum(['admin', 'user']), 'user'),
  age: integer(),
  score: numeric().nullable(),
  createdAt: defaultTo(timestamp(), 'now'),
});
export type _Style1 = Expect<Equal<Entity<typeof FnStyleSchema>, Entity<S>>>;
export type _Style2 = Expect<Equal<CreateDTO<typeof FnStyleSchema>, CreateDTO<S>>>;
