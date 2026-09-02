// Compile-time type assertions for the relations module.
// Checked by `yarn typecheck`.

import type { Entity, Equal, Expect, Populated } from '../index.ts';
import type { Post, Profile, User } from './fixtures.ts';
import type { attachPopulated, JoinRow } from './index.ts';

// 1. Foreign key type checking — deleted with `references()` (plan D2).
//
// `references(integer(), UserSchema, 'id')` took a column *builder*'s output and compared its
// TypeScript type against the target column's, which needed the target schema value's literal
// column map. Four assertions lived here: a valid key, a column name that does not exist on the
// target, a type mismatch resolving to a branded `{ __error }`, and that branded object failing
// to assign to a `ColumnMeta`.
//
// The tagged spelling is `References<'users.id'>` on the column, and it does not carry the type
// comparison: it is a string, and the reflection has one table in front of it. What survives is
// `tags/serial-foreign-key.type-test.ts`, which covers the case a single declaration can state —
// a column pointing at a `Serial` primary key has to be a plain `number`. Comparing a foreign key
// against the type of the column it names is a check nothing performs today.

// 2. Relation builders — deleted.
//
// `manyToOne(UserSchema, 'bad_col')` was refused by a `ColumnNameOf<Target>` that had to look
// through a `TaggedSchema`'s phantom to find literal column names, because the schema *value*
// erases them. Three `@ts-expect-error` assertions covered the three builders. Naming a column
// that does not exist is now `OneToMany<'posts', 'usrId'>`, which a type parameter cannot
// refuse: the tag names its target by table name, and a table name is not a type. What
// refuses it is resolution, against the table the reflection produced — see
// `populate.spec.ts`, where an unknown relation names the ones the type does declare.

// 3. What a populated relation holds.
//
// `PopulatedEntity<Base, Relations, K>` took a relations map and dug the target row type back
// out of it; `Populated<T, K>` reads it off `T`. The full family of assertions is in
// `../derive/tagged-dto.type-test.ts`; these two are here because these fixtures are what
// `populate.spec.ts` resolves, so the type and the SQL are pinned against one declaration.
export type _Pop1 = Expect<Equal<Populated<User, 'posts'>['posts'], readonly Entity<Post>[]>>;
export type _Pop2 = Expect<Equal<Populated<User, 'profile'>['profile'], Entity<Profile> | null>>;
export type _Pop3 = Expect<Equal<Populated<Post, 'author'>['author'], Entity<User> | null>>;
// The columns come through untouched, tags and all — `Populated` widens a row, it does not
// re-derive one.
export type _Pop4 = Expect<Equal<Populated<User, 'posts'>['email'], Entity<User>['email']>>;

// A relation that was not populated is not on the row. `Entity<T>` drops every relation key,
// and `Populated<T, K>` adds back exactly `K` — so `profile` is absent from a read that asked
// for `posts`, which is what the runtime does.
export type _Pop5 = Expect<Equal<'profile' extends keyof Populated<User, 'posts'> ? true : false, false>>;

// --- attachPopulated -------------------------------------------------------
type UserRow = { id: number; email: string };
type PostRow = { id: number; title: string };
export type _Attach1 = Expect<
  Equal<ReturnType<typeof attachPopulated<UserRow, 'posts', PostRow[]>>, UserRow & { posts: PostRow[] }>
>;

// --- JoinRow ---------------------------------------------------------------
interface Emp {
  id: number;
  recipient_id: number;
}
interface Recipient {
  r_id: number;
  r_name: string;
}
export type _Join1 = Expect<Equal<JoinRow<Emp, Recipient, 'left'>['r_name'], string | undefined>>;
export type _Join2 = Expect<Equal<JoinRow<Emp, Recipient, 'inner'>['r_name'], string>>;
export type _Join3 = Expect<Equal<JoinRow<Emp, Recipient>, JoinRow<Emp, Recipient, 'left'>>>;
