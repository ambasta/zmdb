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
