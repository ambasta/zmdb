# Derived DTOs from a Tagged Type — Spec (PRD §6.7 REQ-TF-4 … REQ-TF-6)

> Part of `@zmdb/schema-core` (module `src/derive/`). Types only; no runtime export.
> Design: `DESIGN-type-first.md` §4.2, `PLAN-type-first.md` Phase 3.

## 1. One set of names

These are the same names the schema-value derivations in `../index.ts` use, and that
is deliberate: per plan D2 there is to be exactly one `Entity`/`CreateDTO`/`UpdateDTO`,
and these are the ones that survive. They live in a separate module only so the
repository, the web package and every fixture keep compiling while the migration runs;
Phase 9 deletes the schema-value versions and re-points the package root here.

Every derivation takes a tagged type and nothing else. There is no conditional
dispatch on `{ columns: … }` — backwards compatibility is not a requirement (plan D2),
which also means no per-use `extends` test and no instantiation cost from a dispatch.

## 2. Key filters

```ts
type KeysCarrying<T, Tag> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Tag ? (K extends string ? K : never) : never;
}[keyof T];
```

| Export              | Selects                                     |
| ------------------- | ------------------------------------------- |
| `SerialKeys<T>`     | `Serial` — database-generated               |
| `DefaultKeys<T>`    | `HasDefault`                                |
| `PrimaryKeyKeys<T>` | `PrimaryKey`                                |
| `SensitiveKeys<T>`  | `Sensitive`                                 |
| `UniqueKeys<T>`     | `Unique`                                    |
| `NullableKeys<T>`   | `null extends T[K]` — native, not a tag     |
| `RelationKeys<T>`   | `AnyRelation` — a join target, not a column |
| `ColumnKeys<T>`     | every string key that is **not** a relation |

Three details are load-bearing:

- **`NonNullable<T[K]>`, not `T[K]`.** A nullable defaulted column is declared
  `(string & HasDefault) | null`, and `null` is not assignable to a weak object type,
  so the union as a whole does not match `HasDefault`. Testing the non-nullable arm is
  what makes such a column optional on insert instead of required.
- **`-?` on the probe**, so an already-optional property is still examined under
  `exactOptionalPropertyTypes`.
- **`K extends string`**, so entity-level tags (`Table`, `Fts`) arriving through
  `extends` never show up in `keyof`.

`ColumnKeys<T>` is written out as its own projection rather than as
`Exclude<AllKeys<T>, RelationKeys<T>>`, which does not compile. For an unresolved `T`
both operands normalise to the same deferred expression, so the subtraction yields
`never` — and then `Pick<Entity<T>, DefaultKeys<T>>` is an error, because nothing is a
key of an entity with no keys.

That same limit is why `AsColumns<T, K> = K & keyof Entity<T>` exists. `SerialKeys<T>`
and friends _are_ subsets of `ColumnKeys<T>` — a relation cannot carry `Serial` — but
TypeScript only relates two of these projections while the target's template is
unconditional, and `ColumnKeys<T>`'s is a conditional on the relation tag. So the subset
is stated as an intersection, which is assignable to either side by definition, rather
than proved. Nothing changes for a concrete type.

## 3. The DTO suite

| Type              | Shape                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `Entity<T>`       | Every column, required, sensitive included, tags preserved.              |
| `CreateDTO<T>`    | `Serial` columns **absent**; `HasDefault` and nullable columns optional. |
| `UpdateDTO<T>`    | `Serial` and `PrimaryKey` dropped; everything else optional.             |
| `ReadDTO<T>`      | `Sensitive` columns removed.                                             |
| `PrimaryKeyOf<T>` | Scalar for one key, object map for a composite, `unknown` for none.      |

`CreateDTO` omits a generated column rather than making it optional. Supplying a
defaulted column is legitimate; supplying a generated one is a mistake, so the two
tags produce different shapes — that is the whole reason they are separate tags.

A nullable column is optional for the same reason a defaulted one is: omitting the key
inserts `NULL`, which is exactly what passing `null` does. The generated `create`
document has never listed a nullable column as required, and the repository has never
demanded it at runtime, so requiring it in the type meant a client that followed the
published contract wrote a payload the type rejected. It stays present-and-optional
rather than absent, because passing `null` explicitly is legitimate.

Tags survive every derivation. If a derivation dropped one, the AOT would emit a
weaker check for the update path than for the insert path, silently (REQ-TF-5). The
type tests assert the full intersection, tags included, on both.

`PrimaryKeyOf` is named for plan D1 so the _tag_ can be `PrimaryKey` — which is the
name typed at every declaration site.

**A relation is not a column.** A property declared `author?: User & ManyToOne<…>` is a
join target, so `RelationKeys<T>` takes it out of `Entity<T>` and therefore out of
everything derived from it. Left in, it would be a column to `INSERT`, a column to
`SELECT` and a JSON Schema property, none of which it is.

## 3a. The read/query surface (`./query.ts`)

The type-first counterpart of the schema-keyed shapes in `../dto/index.ts`:
`WhereDTO<T>`, `OrderByDTO<T>`, `PaginationDTO<T>`, `Projection<T, K>`,
`GetOptions<T>`, `GetDTO<T, O>`, `ListDTO<T>`, `PopulatedEntity<T, K>` /
`Populated<T, K>`, `JoinRow<T, K, Kind>`.

Two things there are deliberately **not** duplicated:

- **The operator vocabulary.** `FieldOps<V>` and `SubqueryTarget<V>` are keyed off a
  column's value type and never mention a schema, so there is nothing in them to
  re-point. A second copy would be a second operator set to keep in step.
- **Every runtime helper.** `compileWhere`, `applyOrderBy`, `applyPagination`, `project`
  and `buildListResult` already take schema-agnostic views — `WhereTarget`,
  `OrderBySpec`, `PaginationSpec` — precisely so a caller's own typed DTO is assignable
  without a widening cast. A tagged type's DTO is assignable to the same views, so the
  existing functions serve both and `./query.ts` is types only.

`WhereDTO<T>` carries the operators. It replaced a `Partial<Entity<T>>` that did not:
the package root publishes the operator-bearing `WhereDTO` from `../dto/index.ts`, so the
weaker spelling would have quietly dropped `{ age: { gte: 18 } }` from every caller the
moment Phase 9 re-pointed the root here.

Two shapes are strictly better than their schema-keyed originals, because a schema
_value_ cannot express them:

- `GetOptions<T>.populate` is `readonly RelationKeys<T>[]`, not `readonly string[]`, so a
  misspelled relation name is a compile error.
- `Populated<T, K>` reads the cardinality off the **declaration**: `author?: User &
ManyToOne<…>` is one `User` and `comments?: Comment[] & OneToMany<…>` is an array,
  natively (REQ-TF-2). The schema-value version had to recover the target type and
  rebuild the array from a `RelationMeta` through six nested conditional types
  (`../relations/index.ts`'s `RelationEntityFromDef`), because a relation value does not
  carry its target's type. Nothing in `./query.ts` reads a cardinality at all.

`Populated` strips `undefined` from the relations it names. A relation is declared
optional, which is what lets an unpopulated row exist; populating one is exactly the
claim that it is there. `-?` alone will not do it — the key set is `K & keyof T`, so the
mapped type is not homomorphic and the modifier has nothing to strip.

## 4. The wire shape (plan D3 / REQ-TF-13)

`Entity<T>` is the **app** type. `Wire<T>` and `WireCreateDTO<T>` are what a JSON body
actually contains: a `timestamp` becomes `string` and a `bigint` becomes `string`,
because neither survives JSON. Nullability is carried through (`string | null`). The
web pipeline decodes wire → app once at the boundary so handlers keep seeing `Date`.

## 5. Test strategy: exact identity, never assignability

Every assertion about a derivation uses `Expect<Equal<…>>`.

A key filter that stops matching resolves to `never`, and `never` is assignable to
everything — so `SerialKeys<User> extends 'id'` passes even when the filter is
completely broken, and `Omit<T, never>` is `T`, and `Partial<Pick<T, never>>` is `{}`.
The first probe written for plan D5 was fooled by exactly that and reported success
while no tag was matching at all. `../tags/duplicate-install.type-test.ts` records the
trap as `_D6_asserts_nothing` so nobody lays it again.

## 6. Verified

- [x] All six key filters return the exact expected key union, and `never` where nothing matches.
- [x] Entity-level tags do not leak into `keyof Entity<T>`.
- [x] A nullable defaulted column is optional on insert, not required.
- [x] A nullable column with **no** default is optional on insert too, and the `create` document agrees (`../ir/ir.spec.ts`).
- [x] `id` is absent from `CreateDTO`; supplying it is a compile error (`@ts-expect-error`).
- [x] Constraint tags survive `Omit`, `Pick` and `Partial` on both the insert and update paths.
- [x] Reading a `Sensitive` column off a `ReadDTO` is a compile error.
- [x] `PrimaryKeyOf` yields a scalar for a single key and an object map for a composite one.
- [x] `Wire<T>['createdAt']` is `string` while `Entity<T>['createdAt']` is `Date & …`.
- [x] A relation property is in `RelationKeys<T>`, out of `ColumnKeys<T>`, out of `keyof Entity<T>` and out of `CreateDTO<T>`.
- [x] A type with no relations keeps every column: `RelationKeys<User>` is `never` and `ColumnKeys<User>` is still `keyof Entity<User>`.
- [x] `Populated<Post, 'author'>` is one `User` and `Populated<Post, 'comments'>` is an array, with no cardinality read anywhere; populating one relation does not conjure the other.
- [x] `Populated<Post, 'title'>` is a compile error — a column cannot be populated.
- [x] `JoinRow`'s joined half is `Partial` for a `LEFT` join and not for an `INNER` one, while the base row's own columns stay required either way.
- [x] `OrderByDTO<Post>['column']` names the three columns and rejects a relation; `GetDTO` narrows to `select` and falls back to the whole row.
- [x] `WhereDTO<T>` accepts `{ age: { gte: 18, lt: 65 } }` and the `or` combinator, not just bare values.
- [x] The module has zero runtime exports (`../tags/erasure.spec.ts`).

## 7. Non-goals (rejected)

- A conditional dispatch accepting either a schema value or a tagged type. It existed
  only to keep `Entity<typeof UserSchema>` compiling, and it costs an `extends` test at
  every use (plan D2).
- Making a generated column optional on insert rather than absent.
- Runtime stripping as the mechanism for `Sensitive`. The type must make the leak
  impossible; stripping is the belt, not the braces.
- A `Partial<Entity<T>>` `WhereDTO`. §3a.
- Reading cardinality back out of a relation tag. The declared type already says it, and
  a tag that has to be decoded is a tag that can disagree with the declaration.
- A second copy of the operator types or the query folders. §3a.
