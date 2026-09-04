// REQ-TF-10: a generated schema value still knows the declaration it came from.
//
// `schemaOf<T>()` produces a `TaggedSchema<T>`, and the phantom `T` is the entire mechanism.
// Every derivation in `./derive` takes the declared type; none of them looks at a column map.
// So the only job a schema *value* has, type-wise, is to carry `T` back to a boundary — and
// there is exactly one way it does that, which is `TaggedSchema<T>` in a parameter position
// and inference doing the rest.
//
// This file asserts that crossing and nothing downstream of it. That `Entity<User>` omits the
// relations and `CreateDTO<User>` omits the serial key is `derive/tagged-dto.type-test.ts`'s
// business; what is checked here is that a caller holding a value gets the same `T` the
// author declared, and that a value with no phantom cannot make the crossing at all.
//
// No runtime code: a compilation gate, run by `yarn typecheck` and therefore by CI.
// `schemaOf` is imported for its *signature* — it is compiled away at build time, and calling
// it in a file the transform never sees would throw.

import type { WhereDTO } from './dto/index.js';
import type {
  CoreSchema,
  CreateDTO,
  DeclaredTable,
  Entity,
  Equal,
  Expect,
  Extends,
  PrimaryKeyOf,
  schemaOf,
  TaggedSchema,
} from './index.js';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from './tags/index.js';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

type Generated = ReturnType<typeof schemaOf<User>>;
declare const generated: Generated;

// The generated value is a schema value. This is what the runtime — the query compiler, the
// validator, `snapshot()` — needs to be true, and it is why the phantom is a property on a
// `CoreSchema` rather than a wrapper around one.
type _IsSchema = Expect<Extends<Generated, CoreSchema<string>>>;

// And the phantom is the declaration itself, not a copy of it reassembled from the columns.
type Recovered<S> = S extends TaggedSchema<infer T> ? T : never;
type _Phantom = Expect<Equal<Recovered<Generated>, User>>;

// --- the crossing ----------------------------------------------------------
// Three boundaries, spelled the way every real one is: declare `TaggedSchema<T>` and let the
// call site infer `T`. `defineRepository`, `findJoined` and `defineEntityStateMachine` are all
// this shape, so if inference stops working here it stops working for all of them.
declare function rowOf<T extends DeclaredTable>(schema: TaggedSchema<T>): Entity<T>;
declare function insertInto<T extends DeclaredTable>(schema: TaggedSchema<T>, dto: CreateDTO<T>): void;
declare function byId<T extends DeclaredTable>(schema: TaggedSchema<T>, key: PrimaryKeyOf<T>): void;

const row = rowOf(generated);
type _Inferred = Expect<Equal<typeof row, Entity<User>>>;

// The DTO rules arrive with `T`, at the call site, with no annotation to carry them: `id` is
// `Serial`, so the database supplies it, and `createdAt` has a default.
insertInto(generated, { email: 'a@b.com' });
// @ts-expect-error — `id` is `Serial`: there is no key to set.
insertInto(generated, { id: 1, email: 'a@b.com' });
// @ts-expect-error — `email` has no default, so it is required.
insertInto(generated, {});

// One primary-key column, so the key is the bare value.
byId(generated, 1);
// @ts-expect-error — the key is a `number`.
byId(generated, 'one');

// The read surface follows for free, because `WhereDTO` and friends are built out of
// `Entity<T>`. If that ever stops being true this is the assertion that says so.
type _Where = Expect<Equal<keyof WhereDTO<User>, keyof Entity<User> | 'and' | 'or' | 'exists' | 'notExists'>>;

// --- and a value that cannot make it ---------------------------------------
// The phantom is a *required* property for this reason. `schemaFromIR` produces a plain
// `CoreSchema<string>` whose columns are `Record<string, ColumnMeta>`, so there is no row type
// to be had from it — and rather than deriving something empty and plausible, the boundary
// refuses it. That is the whole difference from the column-map derivation this replaced: it
// answered, and its answer was wrong.
declare const untagged: CoreSchema<'users'>;
// @ts-expect-error — no phantom, so there is nothing to infer `T` from.
rowOf(untagged);

// --- and the other direction, which used to compile ------------------------
// `Entity<typeof userSchema>` was legal while the derivations read a column map, and it
// answered with the schema value's own five properties — a row type with a `table` and a
// `columns` on it. The constraint is what closes that: `DeclaredTable` is `Table<string>`, a
// bag of optional tag slots, and TypeScript's weak-type rule refuses a source with no property
// in common with it. A schema value has none, so the wrong spelling no longer type-checks.
type _ValueIsNotADeclaration = Expect<Equal<Generated extends DeclaredTable ? true : false, false>>;
// @ts-expect-error — pass the value to something that infers `T`, e.g. `rowOf(generated)`.
type _NotDerivableFromAValue = Entity<Generated>;
