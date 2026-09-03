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

## 5b. Write expressions (frozen — epic "Expression-valued writes")

`SET views = views + 1` needs no read, no version column and no retry loop, which is the whole reason this
exists. But an expression on the write path is a second query language if it is allowed to grow, so the
vocabulary is closed and the rule that closes it comes before the list.

### 5b.1 The inclusion rule

A variant is **in** when, on every supported dialect, it compiles to a single expression that

1. references **exactly one column**, the one being assigned,
2. binds **at most one parameter**, and
3. consists entirely of tokens the emitter owns — no caller text reaches the SQL, and
4. means the **same thing** on all three.

It is **out** when it needs a second column reference, a subquery, a statement rewrite, or any token the
caller supplies.

Rule 4 is separate from rule 3 on purpose, and it is the one that does the work. The tempting version of
this rule is "one operator token per dialect", and it is wrong in both directions:

- It would exclude `concat`, which needs `CONCAT(…)` on MySQL because `||` there is logical OR unless
  `PIPES_AS_CONCAT` is set — so the operator spelling on MySQL does not fail, it evaluates to `0` or `1`
  and writes that. A function call is still one emitter-owned expression over one column, so `concat` is
  in.
- It would admit **division**, which is one token everywhere and three different results. Integer `/`
  truncates on Postgres and SQLite and yields a decimal on MySQL, and division by zero raises on Postgres,
  yields NULL on SQLite, and does either on MySQL depending on `sql_mode`. One declaration, three answers,
  so there is no `div` variant and there will not be one.

### 5b.2 The vocabulary

```ts
export const EXPR: unique symbol; // runtime brand
declare const PHANTOM: unique symbol; // type-only

export type ColumnExpr<T> = {
  readonly [EXPR]: true;
  readonly [PHANTOM]?: T;
} & (
  | { readonly op: 'add' | 'sub' | 'mul'; readonly by: T }
  | { readonly op: 'not' }
  | { readonly op: 'concat'; readonly with: string }
  | { readonly op: 'coalesce'; readonly fallback: T }
  | { readonly op: 'proposed' }
);

/** A value or a computed expression, per column. A value stays parameterised exactly as today. */
export type SetValue<T> = T | ColumnExpr<T>;

export function inc<T extends number | bigint>(by?: T): ColumnExpr<T>; // default 1
export function dec<T extends number | bigint>(by?: T): ColumnExpr<T>; // default 1
export function mul<T extends number>(by: T): ColumnExpr<T>;
export function not(): ColumnExpr<boolean>;
export function concat(withText: string): ColumnExpr<string>;
export function coalesce<T>(fallback: T): ColumnExpr<T>;
export function proposed<T>(): ColumnExpr<T>;
```

**There is no `column` field, and its absence is the design.** The column is the key of the `set()` object:
`set({ views: inc(1) })` increments `views`. Two things follow, and both were the reason for dropping the
field rather than making it optional. A cross-column reference — `SET a = b + 1` — becomes
_unrepresentable_ rather than merely undocumented, so the non-goal in §5b.6 is enforced by the type instead
of by a review comment. And no column name ever arrives as data on this path, so the identifier-from-caller
problem that `opclass` and `IndexMethod` each had to solve separately does not exist here at all.

**The runtime brand is a symbol, and the emitter tests for the symbol — never for `'op' in value`.** A
`json` column can legitimately hold `{ op: 'add', by: 1 }`; that is somebody's stored document, and
duck-typing would compile their data into SQL. The symbol also cannot survive `JSON.parse`, so a
`ColumnExpr` is unforgeable from a request body — a property §3b of `../repository/SPEC.md` leans on rather
than re-establishing.

The `PHANTOM` field is type-only and exists to pin `T`. Without it, `{ op: 'not' }` mentions `T` nowhere, so
it is a member of `ColumnExpr<number>` as much as of `ColumnExpr<boolean>` and `set({ views: not() })` would
type-check. With it, `ColumnExpr<boolean>` is assignable to no other instantiation. The type-test:

```ts
// @ts-expect-error not() is boolean-only; views is a number
qb.updateTable('posts').set({ views: not() });
// @ts-expect-error inc() is numeric; published is a boolean
qb.updateTable('posts').set({ published: inc(1) });
```

An entry in `set()` whose value does not carry the brand is bound as a parameter exactly as today, so every
golden statement in §4 is unchanged.

### 5b.3 The SQL, per variant, per dialect

```
set({ views: inc(1) }).where('id', '=', 7)
postgres  UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2     parameters: [1, 7]
mysql     UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?       parameters: [1, 7]
sqlite    UPDATE "posts" SET "views" = "views" + ? WHERE "id" = ?       parameters: [1, 7]

set({ stock: dec(2) })
postgres  UPDATE "posts" SET "stock" = "stock" - $1                     parameters: [2]

set({ published: not() })
postgres  UPDATE "posts" SET "published" = NOT "published"              parameters: []
mysql     UPDATE `posts` SET `published` = NOT `published`              parameters: []

set({ title: concat(' (draft)') })
postgres  UPDATE "posts" SET "title" = "title" || $1                    parameters: [' (draft)']
sqlite    UPDATE "posts" SET "title" = "title" || ?                     parameters: [' (draft)']
mysql     UPDATE `posts` SET `title` = CONCAT(`title`, ?)               parameters: [' (draft)']

set({ nickname: coalesce('anonymous') })
postgres  UPDATE "users" SET "nickname" = COALESCE("nickname", $1)      parameters: ['anonymous']
```

`dec` emits `-` rather than `+` with a negated parameter, because `by` may be a `bigint` or a decimal
string and negating it would be a per-type operation in JavaScript that the compiler has no business doing.

`NOT` is the same token on all three; on MySQL it evaluates a `tinyint(1)` to `1` or `0`, which is what the
column stores. `SET` parameters precede `WHERE` parameters, as they already do.

### 5b.4 `proposed`, and the MySQL spelling

`proposed()` is "the value this INSERT tried to write", and it is legal **only** inside
`onConflict(...).doUpdate({...})`. Outside an upsert there is no proposed row, so a plain `update()`
refuses it naming that:

```
proposed() references the row being inserted and is only valid inside onConflict().doUpdate() ("hits" on
"counters")
```

```
insertInto('counters').values({ key: 'k', hits: 1 }).onConflict('key').doUpdate({ hits: inc(1) })
postgres  INSERT INTO "counters" ("key", "hits") VALUES ($1, $2) ON CONFLICT ("key") DO UPDATE SET "hits" = "hits" + $3
mysql     INSERT INTO `counters` (`key`, `hits`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `hits` = `hits` + ?

doUpdate({ hits: proposed() })
postgres  … ON CONFLICT ("key") DO UPDATE SET "hits" = EXCLUDED."hits"
mysql     … ON DUPLICATE KEY UPDATE `hits` = VALUES(`hits`)
```

The unqualified `"hits"` on the right-hand side is the stored row on every dialect, so `inc` inside an
upsert increments the row that was already there — the atomic-counter recipe, and the reason `proposed`
has to be a variant rather than the implicit meaning of a bare column. It also means the upsert path emits
the same expression string as the plain `UPDATE` path, with `EXCLUDED` being the one thing that needs an
explicit qualifier.

**MySQL keeps `VALUES(col)`** — which is what the compiler already emits — and no minimum server version
enters the contract. `VALUES()` in the `ON DUPLICATE KEY UPDATE` clause is deprecated as of MySQL 8.0.20 in
favour of a row alias (`INSERT … AS new … SET c = new.c`), but deprecated is not removed: it still works,
and it works on servers older than 8.0.19 and on MariaDB, which never implemented the alias form at all.
Emitting the alias would break two populations to silence a warning in one. If MySQL removes `VALUES()`,
the emitter needs a server-version probe, and that is named here as future work rather than built on
speculation.

### 5b.5 Nullability, and the one place the vocabulary bites

Every arithmetic and concatenation variant is null-propagating on all three dialects: `NULL + 1` is `NULL`,
`CONCAT('a', NULL)` is `NULL`, `NOT NULL` is `NULL`. So:

- On a `NOT NULL` column the current value cannot be null, and `add`/`sub`/`mul`/`not` cannot produce one.
- `coalesce` with a non-null fallback cannot produce null at all, which is the only variant that is safe
  regardless of the column.
- `concat` with a nullable column produces null, and if that column is `NOT NULL` the contradiction cannot
  arise. If it is nullable, null is a legal value and the write succeeds.

**`inc` on a nullable numeric column yields NULL, not `by`.** This is the classic surprise, and zmdb does
not wrap it in a `COALESCE` to be helpful: that would make `inc` mean two different things depending on a
column's nullability, and the author who wanted the wrapping cannot tell from the call site whether they
got it. The vocabulary cannot compose either — there is no way to say "coalesce then add" — so the answer
is that a counter should be `NOT NULL DEFAULT 0`, which is what the column wanted anyway, and anything
beyond that is raw SQL. This is the closedness costing something, and it is accepted knowingly rather than
discovered later.

One guarantee genuinely weakens: a `varchar` column's `Length<n>` bound is enforced on the value a DTO
validates, and `concat` produces a value no validator sees. Postgres and SQLite raise on overflow; MySQL
**truncates silently** outside strict mode. The check that would prevent it is
`char_length(col) + char_length($1) <= n`, which is a predicate rather than an assignment and therefore out
of this vocabulary. So the gap is stated: a `concat` onto a length-bounded column is the one write where the
declared bound is the database's business rather than zmdb's.

### 5b.6 Non-goals (rejected, and not to be relitigated)

- **Cross-column references.** `SET a = b + 1`. Unrepresentable by construction — there is no `column`
  field. Once a second column may be named, the SET clause needs scope resolution, and scope resolution is
  the general expression builder.
- **A general expression AST.** Nested operators, arbitrary functions, casts. That is a second query
  language with its own dialect table and its own escaping surface, living on the write path where a
  mistake is durable rather than merely wrong once.
- **Subqueries in `SET`.** `SET rank = (SELECT …)`. Needs a whole builder as an operand and re-opens
  parameter numbering across two statements' worth of placeholders.
- **`RETURNING` a computed value.** `RETURNING views + 1` is a projection, not an assignment; projections
  are the select path's problem and the two should not share a vocabulary by accident.
- **Division.** §5b.1, rule 4.

## 5c. Null predicates (frozen — epic "Entity filters and soft delete")

`OP_MAP` gains two entries, and they are the first zero-operand ones:

| `op`          | SQL           |
| ------------- | ------------- |
| `is null`     | `IS NULL`     |
| `is not null` | `IS NOT NULL` |

`compileWhere` binds **no** parameter for either, and a `value` passed alongside one is ignored rather than
bound — a bound-but-unused parameter would shift the numbering of every placeholder after it.

They are needed rather than convenient: a soft-delete filter is `deletedAt IS NULL`, and there was no way
to say that. The alternative a caller reaches for without them is `where('deletedAt', '=', null)`, which
compiles to `"deletedAt" = $1` with a `null` parameter and **matches no rows at all** under SQL's
three-valued logic. That failure is silent and reads as an empty table rather than as a mistake, which is
the worst possible shape for the one predicate that gets conjoined into every query
(`../repository/SPEC.md` §3c).

## 5d. Cursors (frozen — epic "Streaming reads and query cancellation")

**Nothing in this package changes**, and that is the frozen answer rather than an omission. A cursor is
connection lifecycle; a `CompiledQuery` is text and parameters. Teaching the compiler about cursors would
mean retaining per-query state, which §6 already rejects, and it would put a `DECLARE` in front of a
statement whose transaction the compiler cannot see.

Three properties this package already has become **load-bearing** because the streaming driver embeds
`text` verbatim in `DECLARE <name> CURSOR FOR <text>` (`../repository/SPEC.md` §1a):

- **`text` is exactly one statement, and carries no trailing semicolon.** Every golden in §4 shows this;
  it was cosmetic and now it is required, because a `DECLARE` prefixing a semicolon-terminated string is a
  syntax error and a `DECLARE` prefixing two statements would be something worse.
- **Placeholders start at `$1` and are numbered over the statement alone.** The `DECLARE` prefix binds
  nothing, so a driver can wrap the text without renumbering — the one thing that would have forced a
  compiler change if it were not already true.
- **Nothing the caller supplied reaches `text` unparameterised** (§5a, §5b.2), which is what makes wrapping
  it in another statement safe at all. A compiler that interpolated even identifiers from data would turn
  the cursor wrapper into an injection point one layer below where anybody would look for one.

Streaming does not want a rewritten query either. No implicit `ORDER BY` is added: a cursor over an
unordered `SELECT` is as well-defined as the non-streaming version of the same read, and inventing an
ordering would change results silently and defeat any index the author chose. No implicit `LIMIT`, for the
same reason — bounding a stream is what `batchSize` is for, and it bounds memory rather than the result.

## 6. Non-goals / anti-patterns (rejected)

- No runtime type resolution (no reliance on schema types at runtime).
- No retained per-query metadata objects beyond the returned CompiledQuery.
- No implicit query building (`.where({obj})` object sugar) — explicit args only.
