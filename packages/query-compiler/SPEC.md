# @zmdb/query-compiler — Frozen Spec (Issue #16)

> Status: **FROZEN** for TDD. Implementation (#17–#20) must satisfy this spec.
> Targets: Node 26+, ESM-only, TS 7 semantics.

## 1. CompiledQuery contract

```ts
interface CompiledQuery {
  readonly text: string; // SQL with placeholders
  readonly parameters: readonly unknown[]; // positional, in placeholder order
}
```

`.compile()` on any builder returns a `CompiledQuery`. Compilation is a pure
function of the builder state; calling `.compile()` twice yields deep-equal output.

## 2. Builder grammar

```ts
qb.selectFrom(table)
  .select(columns?)          // default '*'
  .where(col, op, value)
  .andWhere(col, op, value)
  .orWhere(col, op, value)
  .orderBy(col, 'asc'|'desc')
  .limit(n)
  .offset(n)
  .compile()

qb.insertInto(table).values(obj).returning(cols?).compile()
qb.updateTable(table).set(obj).where(...).returning(cols?).compile()
qb.deleteFrom(table).where(...).returning(cols?).compile()
```

Builders are immutable: each method returns a new builder.

## 3. Placeholder policy (per dialect)

| Dialect            | Placeholder | Identifier quote |
| ------------------ | ----------- | ---------------- |
| postgres (default) | `$1, $2, …` | `"ident"`        |
| mysql              | `?`         | `` `ident` ``    |
| sqlite             | `?`         | `"ident"`        |

`createQueryCompiler(dialect?: 'postgres' | 'mysql' | 'sqlite')` — default `postgres`.

## 4. Golden SQL fixtures (postgres)

```
selectFrom('users').where('email','=','a@b.com').orderBy('createdAt','desc').limit(10)
=> text: SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10
   parameters: ['a@b.com']

selectFrom('users').where('role','=','admin').andWhere('active','=',true)
=> text: SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2
   parameters: ['admin', true]

insertInto('users').values({ email:'a@b.com', role:'user' }).returning(['id'])
=> text: INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"
   parameters: ['a@b.com', 'user']

updateTable('users').set({ role:'admin' }).where('id','=',1)
=> text: UPDATE "users" SET "role" = $1 WHERE "id" = $2
   parameters: ['admin', 1]

deleteFrom('users').where('id','=',1)
=> text: DELETE FROM "users" WHERE "id" = $1
   parameters: [1]
```

### mysql / sqlite placeholder variants

Same builder as the first SELECT above but with mysql:

```
=> text: SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10
```

## 5. Set Operations and Empty IN Lists

- `whereIn(col, [])` and `IN` with an empty array compile to `1 = 0` so that an empty IN list matches no rows rather than raising a SQL syntax error.
- `whereNotIn(col, [])` and `NOT IN` with an empty array (or an array containing only `null`/`undefined` values) compile to `1 = 1` so that an empty NOT IN list matches all rows without throwing a syntax error or triggering three-valued SQL NULL evaluation traps.

## 5a. Extension operators and spatial predicates (frozen — epic "Database extensions")

pgvector's three distance operators are added to `OP_MAP` under **names**, not under their punctuation:

| `op`     | SQL   | Meaning       |
| -------- | ----- | ------------- |
| `l2`     | `<->` | L2 distance   |
| `cosine` | `<=>` | Cosine        |
| `ip`     | `<#>` | Inner product |

Two reasons, and the second is the decisive one.

`sqlOperator` maps a known operator and **falls through with an unmapped one written as given** — pinned
by `allows unmapped raw Postgres/SQL operators to fall through as-written`. That is defensible where it
lives: a builder call is code an author wrote, `@>` is a real operator, and enumerating every operator of
three dialects is a losing game. It is not defensible one layer up, where `compileWhere` in
`schema-core/src/dto` turns a request body into predicates, and #364 is that gap seen from the security
side. So a `<->` typed into `where()` would already "work" today, by fall-through, on the one surface that
must not be reachable from user JSON. A **mapped name** works on both surfaces, and it is testable that it
is mapped rather than passed through, which the punctuation spelling is not.

And `<=>` is not free to take. In MySQL it is the NULL-safe equality operator, so one string would mean
two unrelated things depending on the dialect, and the compiler would be unable to refuse it on the
dialect where it is valid but wrong.

```
selectFrom('items').where('embedding', 'cosine', [0.1, 0.2])
=> text: SELECT * FROM "items" WHERE "embedding" <=> $1
   parameters: [[0.1, 0.2]]
```

All three are Postgres-only and refused elsewhere at compile time, naming the operator and the dialect.
The nearest-neighbour ordering that makes them useful (`ORDER BY embedding <=> $1 LIMIT 10`) is an
ordering over an expression, which `orderBy(col, dir)` cannot express and this epic's implementation
slices own.

**PostGIS predicates are functions, not operators**, so they do not go in `OP_MAP` at all. They are a
predicate kind of their own with a closed function set:

```ts
type SpatialFn = 'st_contains' | 'st_within' | 'st_intersects' | 'st_dwithin';
type Predicate = … | { kind: 'spatial'; fn: SpatialFn; col: string; value: unknown; distance?: number };
```

```
{ kind: 'spatial', fn: 'st_intersects', col: 'area', value: geojson }
=> ST_Intersects("area", ST_GeomFromGeoJSON($1))

{ kind: 'spatial', fn: 'st_dwithin', col: 'location', value: geojson, distance: 500 }
=> ST_DWithin("location", ST_GeomFromGeoJSON($1), $2)
```

`ST_DWithin` is why `distance` is a field rather than an extra element of `value`: it is the one member
with a third argument, it is a number rather than a geometry, and it is a parameter rather than
interpolated text. A closed enum, again, because the function name is emitted unquoted and the whole
point of a spatial predicate is that a caller supplies the geometry — the value — and never the SQL.

## 6. Non-goals / anti-patterns (rejected)

- No runtime type resolution (no reliance on schema types at runtime).
- No retained per-query metadata objects beyond the returned CompiledQuery.
- No implicit query building (`.where({obj})` object sugar) — explicit args only.
