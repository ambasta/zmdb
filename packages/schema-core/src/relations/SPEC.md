# Entity Relations — Spec

Originally frozen for TDD as issue #30, and rewritten when the relation DSL went away. No identity map, no proxies, no lazy loading — those are still non-goals and always were.

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

The reflection reads them into `SchemaIR.relations` as `{ name, relation, target, via }` — `via` being the foreign-key column, or the join table for `manyToMany`. A relation is not a column:
`Entity<T>`, `CreateDTO<T>` and the DDL all drop these keys.

There used to be a second spelling. `manyToOne(UserSchema, 'userId')` and its three siblings returned a frozen `RelationMeta`, and a `RelationsMap` of those was handed to a repository or to
`toJsonSchemaWithRelations` so it could learn what the declaration had already said. Both are gone, along with `Cardinality`, `RelationDef`, `RelationsMap` and the six conditional types
(`RelationEntityFromDef`, `RelationCardinalityFromDef`, `DerivedEntity`) that existed to recover a target's row type from a value built out of that type in the first place.

### 1.1 Referential actions (frozen — epic "Referential actions")

Two facts have to be said before the shape, because they change what this epic is.

**There is no `RelationDef` to put `onDelete` on.** It was removed with the relation DSL (§1 above), so an action is declared as a tag on the column that holds the key — which is also where
`References` already is, and a referential action is a property of the foreign key rather than of the relation that reads it:

```ts
interface Post extends Table<'posts'> {
  userId: number & Sql<'integer'> & References<'users.id'> & OnDelete<'cascade'>;
  editorId: (number & Sql<'integer'> & References<'users.id'> & OnDelete<'set null'>) | null;
}

type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';
```

`ColumnIR.references` is reflected both for relation resolution and for the migration snapshot. `../../../query-compiler/src/migrations/SPEC.md` §1.6 owns the constraint shape, statements and diff.

Omitting both tags emits `NO ACTION`, explicitly rather than by leaving the clause off, because MySQL and Postgres both default to `NO ACTION` and writing it makes the emitted DDL say what the
declaration means.

Two separate tags rather than a second parameter on `References`. `onDelete` and `onUpdate` are independently optional, so an options object makes absence a missing key in a partial object type where
two tags make it the absence of a tag — and `References` would become the only member of the tag vocabulary taking a second type parameter, when every other tag composes by intersection.

`packages/repository/src/tagged-to-ddl.spec.ts` follows the declaration through the real snapshot and asserts that all four root-dialect plans contain `REFERENCES`; Cockroach inherits the Postgres
form, while SingleStore refuses foreign keys explicitly. `tests/api-coverage/mapping.mjs` cites that shipped behavior.

#### Two references to one table are two constraints

`ColumnIR.references` is per column, and the grouping rule is that **each `References` is its own single-column foreign key**. It is spelled out because the obvious alternative — group the columns
that reference the same table — is wrong on the most ordinary schema there is:

```ts
createdBy: number & Sql<'integer'> & References<'users.id'>;
updatedBy: number & Sql<'integer'> & References<'users.id'>;
```

Grouped, those become one composite constraint requiring `createdBy` and `updatedBy` to point at the _same_ user, which is a rule nobody wrote and which fails on the second edit of any row.

A composite foreign key is therefore declared explicitly, at the table level, naming all three parts so nothing has to be parsed out of a dotted-and-comma'd string:

```ts
interface Membership extends Table<'memberships'>, ForeignKey<'tenantId,userId', 'users', 'tenantId,id'> {}
```

Local columns, target table, target columns — positionally paired, equal lengths, refused otherwise, the same rule and the same diagnostic style as `ResolvedRelation` in §2.1. This depends on the
composite-key epic having landed `SchemaIR.primaryKey` as an ordered list, because the target columns must be a key or a unique constraint on the target and there is nothing to check that against
otherwise.

#### `set null` and `set default` are refused at build time

```
posts.userId: OnDelete<'set null'> on a NOT NULL column; a delete would have to write NULL into a column
that forbids it — make the column nullable, or use 'cascade' or 'restrict'
```

The database finds this at delete time, on a delete of a row that happens to have children, which is months later and in production. `set default` on a column with no `HasDefault` is refused the same
way, for the same reason.

## 2. Resolving one

`resolveRelation(ir, name)` turns a `RelationIR` into the pair of columns a query matches on:

```ts
interface ResolvedRelation {
  readonly name: string;
  readonly targetTable: string;
  readonly parentKey: readonly string[]; // on the declaring table
  readonly targetKey: readonly string[]; // on the target, positionally paired
  readonly toMany: boolean;
}
```

Three cases, and which one applies is a fact about the tables rather than about the tag:

- **Owning side** (`ManyToOne`, and `OneToOne` where this table has the column) — `parentKey` is `via` split on commas in written order, and `targetKey` contains what each column's
  `References<'table.column'>` names. A one-column relation without `References` still defaults to `id`; every column of a composite relation must carry `References`.
- **Inverse side** (`OneToMany`, and `OneToOne` where this table does _not_ have the column) — `parentKey` is the whole ordered primary key and `targetKey` is `via` split on commas. A `OneToOne` pair
  is symmetric and the tag cannot say which half stores the key; the answer is "the one with the column".
- **`ManyToMany`** — throws. `via` is a join table, not a column, so one `IN` cannot express it, and inferring the join table's two foreign keys from the names either side is how a wrong query gets
  built quietly. Join the two tables explicitly.

An unknown name throws and lists the relations the type does declare, because the reason a name is unknown is almost always a typo in a `populate`.

### 2.1 A composite parent key

Both sides are ordered lists, and their **lengths must match**. This replaced the old first-element read, which silently joined a two-column parent on half its key and produced a superset of the right
rows — the worst available failure, because extra children look like data rather than like a query defect.

Pairing is **positional**: `parentKey[i]` joins to `targetKey[i]`. Nothing is matched by name, because the two tables are free to name the same fact differently (`users.id` ↔ `memberships.user_id`)
and that is the normal case rather than the exception.

- **Owning side** — `parentKey` is `via` split on `,` in written order, and `targetKey` is what each column's `References<'table.column'>` names. A relation whose `via` names two columns where only
  one carries a `References` is refused rather than defaulted to `id`.
- **Inverse side** — `parentKey` is the whole `ir.primaryKey`, in its declaration order, and `targetKey` is `via`. This is where the length check earns its place: an inverse relation naming one target
  column on a table keyed `(tenantId, id)` supplies one column against two.
- **`ManyToMany`** — still throws, for the reason it already did.

A length mismatch is refused **at derivation**, with a diagnostic, not at query time:

```
users.posts: OneToMany<'posts', 'userId'> supplies 1 target column for a 2-column parent key
(tenantId, id); name every column, in key order — OneToMany<'posts', 'tenantId,userId'>
```

Naming the key order in the message is the point. The author has to write the columns in the order the parent key declares, and the diagnostic that tells them the count is wrong without telling them
the order is the one that gets fixed twice.

Downstream, `compilePopulate` conjoins the pairs — a to-one becomes `INNER JOIN t ON p.a = t.x AND p.b = t.y`, and a to-many's batched lookup becomes a tuple `IN` (`WHERE (a, b) IN ((…), (…))`) on
Postgres, MySQL and SQLite. SQL Server is refused explicitly because it does not support row-value `IN`.

SQLite has row values from 3.15, so the same form works there; a driver that predates it is out of scope, and the alternative — an `OR` of conjunctions, one per parent — grows the statement with the
batch and is what the `IN` was introduced to avoid. No parent keys is still `WHERE 1 = 0`.

A single-column key resolves to a one-element list, so there is one code path rather than a general one and a fast one. `parentKey[0]` disappears from the module entirely; a consumer that wants one
column asserts the length it expects.

## 3. Reading them

- `populate(['posts'])` marks relations for eager, explicit loading. Nothing is attached to a row that was not asked for — an unpopulated relation is **absent**, not `undefined`.
- `Populated<T, K>` (in `../derive/query.ts`) widens `Entity<T>` with exactly the keys in `K`. A to-many becomes `readonly Entity<Target>[]`, a to-one `Entity<Target> | null`: a foreign key can match
  nothing, and the empty array covers the to-many case.
- `compilePopulate(ir, name, dialect, parentIds, targetFilters?, schemas?)` compiles one: an unfiltered to-one is an `INNER JOIN` on every resolved pair, a filtered to-one is a `LEFT JOIN` with target
  predicates in `ON`, and a to-many is a batched scalar or tuple `IN (…)` select with target predicates in `WHERE`. No parent keys is `WHERE 1 = 0` rather than every row. The optional schema set
  resolves a relation's declared target table and columns to physical SQL names; identity names need no extra argument.
- `attachPopulated(parent, name, value)` returns a new parent object with the relation attached. Never mutates the input.
- `toJsonSchemaWithRelations(schema, variant)` adds a `$ref` per relation to the `entity` variant only — a to-many as an array of them. Input bodies are columns.

### 3.1 Populating a filtered target (frozen — epic "Entity filters and soft delete")

`compilePopulate` accepts the target's filters, and the two relation kinds take them in different places because only one of them can drop a parent row.

**To-many** — the filters conjoin the batched query's `WHERE`, after the `IN`:

```
SELECT * FROM "posts" WHERE "userId" IN ($1, $2) AND "posts"."deletedAt" IS NULL
```

Nothing about the parents changes; a parent whose children are all filtered out gets `[]`, which the relation's type already allows. The no-parent-keys case stays `WHERE 1 = 0` with nothing appended.

**To-one** — a filtered target turns the join into a `LEFT JOIN` and the filters go in the **`ON`**:

```
SELECT * FROM "posts" LEFT JOIN "users"
  ON "posts"."userId" = "users"."id" AND "users"."deletedAt" IS NULL
```

An `INNER JOIN` would delete the post from the result because its author is invisible, which is a claim about `posts` that a filter on `users` has no business making. And moving the predicate to a
trailing `WHERE` undoes the left join: the unmatched row has `NULL` in every `users` column, so any filter other than an `IS NULL` evaluates to `NULL` there and the parent is dropped after all.

An **unfiltered** target keeps the `INNER JOIN` this module emits today, so no golden statement moves. That leaves a known seam: `Populated<T, K>` types a to-one as `Entity<Target> | null`, which an
`INNER JOIN` cannot produce — it drops the parent instead — so the filtered path is the first one where that declared type is true. Closing the gap for the unfiltered path is a real fix and is not
this epic's.

`ManyToMany` throws at resolution, so there is no third case. The read and write rules, the disabling API and where a filter is declared live in `../../../repository/SPEC.md` §3c.

## 4. Join rows

`JoinRow<Base, Joined, Kind>` is `Base & Joined` for an `INNER` join and `Base & Partial<Joined>` for a `LEFT` one, because a left join can produce a row with no match. `../derive/query.ts` exports
the same asymmetry as `JoinRow<T, K, Kind>`, naming the joined side by relation key instead of by type.

`aliasRow(row, map)` renames aliased columns per a `{ alias: outKey }` map: each mapped key becomes its out key and the original is dropped, un-mapped keys are kept as they are, renames apply in `map`
key order, and the input row is never mutated.

## 5. Non-goals (rejected)

Identity map / shared references. Proxy lazy getters. Automatic cascade via tracking.
