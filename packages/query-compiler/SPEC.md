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

## 6. Non-goals / anti-patterns (rejected)

- No runtime type resolution (no reliance on schema types at runtime).
- No retained per-query metadata objects beyond the returned CompiledQuery.
- No implicit query building (`.where({obj})` object sugar) — explicit args only.
