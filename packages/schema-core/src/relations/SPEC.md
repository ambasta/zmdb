# Entity Relations — Spec

Originally frozen for TDD as issue #30, and rewritten when the relation DSL went away. No
identity map, no proxies, no lazy loading — those are still non-goals and always were.

## 1. Where a relation is written

On the type it belongs to, once, with a tag from `@zmdb/schema-core/tags`:

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  posts?: Post[] & OneToMany<'posts', 'userId'>;
  profile?: Profile & OneToOne<'profiles', 'userId'>;
  tags?: Tag[] & ManyToMany<'tags', 'user_tags'>;
}

interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  author?: User & ManyToOne<'users', 'userId'>;
}
```

The reflection reads them into `SchemaIR.relations` as `{ name, relation, target, via }` —
`via` being the foreign-key column, or the join table for `manyToMany`. A relation is not a
column: `Entity<T>`, `CreateDTO<T>` and the DDL all drop these keys.

There used to be a second spelling. `manyToOne(UserSchema, 'userId')` and its three siblings
returned a frozen `RelationMeta`, and a `RelationsMap` of those was handed to a repository or
to `toJsonSchemaWithRelations` so it could learn what the declaration had already said. Both
are gone, along with `Cardinality`, `RelationDef`, `RelationsMap` and the six conditional
types (`RelationEntityFromDef`, `RelationCardinalityFromDef`, `DerivedEntity`) that existed to
recover a target's row type from a value built out of that type in the first place.

## 2. Resolving one

`resolveRelation(ir, name)` turns a `RelationIR` into the pair of columns a query matches on:

```ts
interface ResolvedRelation {
  readonly name: string;
  readonly targetTable: string;
  readonly parentKey: string; // on the declaring table
  readonly targetKey: string; // on the target
  readonly toMany: boolean;
}
```

Three cases, and which one applies is a fact about the tables rather than about the tag:

- **Owning side** (`ManyToOne`, and `OneToOne` where this table has the column) — `parentKey`
  is `via`, and `targetKey` is whatever the column's `References<'table.column'>` names, `id`
  without one.
- **Inverse side** (`OneToMany`, and `OneToOne` where this table does _not_ have the column) —
  `parentKey` is the primary key and `targetKey` is `via`. A `OneToOne` pair is symmetric and
  the tag cannot say which half stores the key; the answer is "the one with the column".
- **`ManyToMany`** — throws. `via` is a join table, not a column, so one `IN` cannot express
  it, and inferring the join table's two foreign keys from the names either side is how a
  wrong query gets built quietly. Join the two tables explicitly.

An unknown name throws and lists the relations the type does declare, because the reason a
name is unknown is almost always a typo in a `populate`.

### 2.1 A composite parent key (frozen — epic "Composite primary keys")

`parentKey` and `targetKey` are single columns above, and `primaryKeyOf(ir)` returns
`ir.primaryKey[0]`. On a table with a two-column key that silently joins on half of it, which
produces a superset of the right rows — the worst available failure, because a to-many
relation returning too many children looks like data rather than like a bug.

Both sides become lists, and their **lengths must match**:

```ts
interface ResolvedRelation {
  readonly name: string;
  readonly targetTable: string;
  readonly parentKey: readonly string[]; // on the declaring table
  readonly targetKey: readonly string[]; // on the target, positionally paired with parentKey
  readonly toMany: boolean;
}
```

Pairing is **positional**: `parentKey[i]` joins to `targetKey[i]`. Nothing is matched by name,
because the two tables are free to name the same fact differently (`users.id` ↔
`memberships.user_id`) and that is the normal case rather than the exception.

- **Owning side** — `parentKey` is `via` split on `,` in written order, and `targetKey` is
  what each column's `References<'table.column'>` names. A relation whose `via` names two
  columns where only one carries a `References` is refused rather than defaulted to `id`.
- **Inverse side** — `parentKey` is the whole `ir.primaryKey`, in its declaration order, and
  `targetKey` is `via`. This is where the length check earns its place: an inverse relation
  naming one target column on a table keyed `(tenantId, id)` supplies one column against two.
- **`ManyToMany`** — still throws, for the reason it already did.

A length mismatch is refused **at derivation**, with a diagnostic, not at query time:

```
users.posts: OneToMany<'posts', 'userId'> supplies 1 target column for a 2-column parent key
(tenantId, id); name every column, in key order — OneToMany<'posts', 'tenantId,userId'>
```

Naming the key order in the message is the point. The author has to write the columns in the
order the parent key declares, and the diagnostic that tells them the count is wrong without
telling them the order is the one that gets fixed twice.

Downstream, `compilePopulate` conjoins the pairs — a to-one becomes `INNER JOIN t ON
p.a = t.x AND p.b = t.y`, and a to-many's batched lookup becomes a tuple `IN`
(`WHERE (a, b) IN ((…), (…))`) on Postgres and MySQL. SQLite has row values from 3.15, so the
same form works there; a driver that predates it is out of scope, and the alternative — an
`OR` of conjunctions, one per parent — grows the statement with the batch and is what the
`IN` was introduced to avoid. No parent keys is still `WHERE 1 = 0`.

A single-column key resolves to a one-element list, so there is one code path rather than a
general one and a fast one. `parentKey[0]` disappears from the module entirely; a consumer
that wants one column asserts the length it expects.

## 3. Reading them

- `populate(['posts'])` marks relations for eager, explicit loading. Nothing is attached to a
  row that was not asked for — an unpopulated relation is **absent**, not `undefined`.
- `Populated<T, K>` (in `../derive/query.ts`) widens `Entity<T>` with exactly the keys in `K`.
  A to-many becomes `readonly Entity<Target>[]`, a to-one `Entity<Target> | null`: a foreign
  key can match nothing, and the empty array covers the to-many case.
- `compilePopulate(ir, name, dialect, parentIds)` compiles one: a to-one is an `INNER JOIN` on
  the resolved pair, a to-many a batched `IN (…)` select over the parent keys, and no parent
  keys is `WHERE 1 = 0` rather than every row.
- `attachPopulated(parent, name, value)` returns a new parent object with the relation
  attached. Never mutates the input.
- `toJsonSchemaWithRelations(schema, variant)` adds a `$ref` per relation to the `entity`
  variant only — a to-many as an array of them. Input bodies are columns.

### 3.1 Populating a filtered target (frozen — epic "Entity filters and soft delete")

`compilePopulate` gains the target's filters, and the two relation kinds take them in different places
because only one of them can drop a parent row.

**To-many** — the filters conjoin the batched query's `WHERE`, after the `IN`:

```
SELECT * FROM "posts" WHERE "userId" IN ($1, $2) AND "posts"."deletedAt" IS NULL
```

Nothing about the parents changes; a parent whose children are all filtered out gets `[]`, which the
relation's type already allows. The no-parent-keys case stays `WHERE 1 = 0` with nothing appended.

**To-one** — a filtered target turns the join into a `LEFT JOIN` and the filters go in the **`ON`**:

```
SELECT * FROM "posts" LEFT JOIN "users"
  ON "posts"."userId" = "users"."id" AND "users"."deletedAt" IS NULL
```

An `INNER JOIN` would delete the post from the result because its author is invisible, which is a claim
about `posts` that a filter on `users` has no business making. And moving the predicate to a trailing
`WHERE` undoes the left join: the unmatched row has `NULL` in every `users` column, so any filter other
than an `IS NULL` evaluates to `NULL` there and the parent is dropped after all.

An **unfiltered** target keeps the `INNER JOIN` this module emits today, so no golden statement moves.
That leaves a known seam: `Populated<T, K>` types a to-one as `Entity<Target> | null`, which an `INNER
JOIN` cannot produce — it drops the parent instead — so the filtered path is the first one where that
declared type is true. Closing the gap for the unfiltered path is a real fix and is not this epic's.

`ManyToMany` throws at resolution, so there is no third case. The read and write rules, the disabling
API and where a filter is declared live in `../../../repository/SPEC.md` §3c.

## 4. Join rows

`JoinRow<Base, Joined, Kind>` is `Base & Joined` for an `INNER` join and `Base &
Partial<Joined>` for a `LEFT` one, because a left join can produce a row with no match.
`../derive/query.ts` exports the same asymmetry as `JoinRow<T, K, Kind>`, naming the joined
side by relation key instead of by type.

`aliasRow(row, map)` renames aliased columns per a `{ alias: outKey }` map: each mapped key
becomes its out key and the original is dropped, un-mapped keys are kept as they are, renames
apply in `map` key order, and the input row is never mutated.

## 5. Non-goals (rejected)

Identity map / shared references. Proxy lazy getters. Automatic cascade via tracking.
