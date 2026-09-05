# @zmdb/query-compiler — Frozen Spec (Issue #16)

> Status: **FROZEN** for TDD. Implementation (#17–#20) must satisfy this spec. Targets: Node 26+, ESM-only, TS 7 semantics.

## Issue #635 target ownership

The current package has 28 build-included TypeScript files and 13 export-map entries. The final owners are 15 files in `@zmdb/sql`, 11 in `@zmdb/migrations`, one naming helper in `@zmdb/schema`, and
one outbox module in `@zmdb/orm`.

`@zmdb/sql` has no dependencies, formatter, schema import, migration import, ORM import, external peer, or `node:*` import. The old package and every `@zmdb/query-compiler/*` path are deleted rather
than forwarded. The exact file and export maps are frozen in `.github/scripts/verify-runtime-foundation.SPEC.md`.

## 1. CompiledQuery contract

```ts
interface CompiledQuery {
  readonly text: string; // SQL with placeholders
  readonly parameters: readonly unknown[]; // positional, in placeholder order
}
```

`.compile()` on any builder returns a `CompiledQuery`. Compilation is a pure function of the builder state; calling `.compile()` twice yields deep-equal output.

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

`returning()` is dispatched through one total statement capability with separate `insert`, `upsert`, `update`, and `delete` entries. The Postgres family and SQLite emit a suffix, SQL Server emits
`OUTPUT` in the statement-specific position, and the MySQL family refuses before returning a `CompiledQuery`. A child dialect can override one statement without claiming the others; in particular, the
shape can represent MariaDB-style INSERT-only support without adding MariaDB to the temporary built-in `Dialect` union.

## 3. Placeholder policy (per dialect)

| Dialect            | Placeholder   | Identifier quote |
| ------------------ | ------------- | ---------------- |
| postgres (default) | `$1, $2, …`   | `"ident"`        |
| mysql              | `?`           | `` `ident` ``    |
| sqlite             | `?`           | `"ident"`        |
| mssql              | `@p1, @p2, …` | `[ident]`        |

`createQueryCompiler(dialect: SqlDialect<Name>)` accepts an injected, already-resolved dialect object. The temporary `createQueryCompiler(dialect?: Dialect)` compatibility overload still defaults to
`postgres`. Cockroach and SingleStore inherit the Postgres and MySQL placeholder/quoting rows; SQL Server uses its dedicated row above. The six shipped compatibility names are `'postgres'`, `'mysql'`,
`'sqlite'`, `'mssql'`, `'cockroach'` and `'singlestore'`.

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

### mysql / sqlite / mssql placeholder variants

Same builder as the first SELECT above but with mysql:

```
=> text: SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10
```

With mssql:

```
=> text: SELECT * FROM [users] WHERE [email] = @p1 ORDER BY [createdAt] DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
```

## 5. Set Operations and Empty IN Lists

- `whereIn(col, [])` and `IN` with an empty array compile to `1 = 0` so that an empty IN list matches no rows rather than raising a SQL syntax error.
- `whereNotIn(col, [])` and `NOT IN` with an empty array (or an array containing only `null`/`undefined` values) compile to `1 = 1` so that an empty NOT IN list matches all rows without throwing a
  syntax error or triggering three-valued SQL NULL evaluation traps.

## 5a. Extension operators and spatial predicates (frozen — epic "Database extensions")

pgvector's three distance operators are added to `OP_MAP` under **names**, not under their punctuation:

| `op`     | SQL   | Meaning       |
| -------- | ----- | ------------- |
| `l2`     | `<->` | L2 distance   |
| `cosine` | `<=>` | Cosine        |
| `ip`     | `<#>` | Inner product |

Two reasons, and the second is the decisive one.

`sqlOperator` maps a known operator and admits an unmapped one only when it is **one bounded SQL token** — pinned by
`allows bounded dialect-specific operator tokens and keeps every value parameterized`. This is deliberately a lexical grammar rather than a dialect/operator allowlist: one to four ASCII letters or
characters from `@<>=!~*&|?-`, with `--` forbidden, plus the exact PostgreSQL-family hash shapes `#>` and `#>>`. The positional-placeholder dialects refuse `?` inside an operator token, and SQL Server
refuses its `@` marker there. It admits PostgreSQL `@>`, `@@`, `<@`, `~*`, `?|` and `#>>`, SQLite `GLOB`, MySQL `<=>` and SQL Server `!<`, while refusing quotes, whitespace, semicolons, comment
openers and placeholder-shaped operators.

That is defensible where it lives: a builder call is code an author wrote, extension operators are real, and enumerating every operator of four root SQL grammars is a losing game. The token grammar
prevents the string from becoming a second SQL expression, but it does not decide which valid operators an HTTP endpoint should expose. One layer up, `compileWhere` in `schema-core/src/dto` turns a
request body into predicates and therefore keeps its own closed set. A `<->` typed into `where()` still works through the bounded token path; a **mapped name** works on both surfaces, and it is
testable that it is mapped rather than passed through, which the punctuation spelling is not.

And `<=>` is not free to take. In MySQL it is the NULL-safe equality operator, so one string would mean two unrelated things depending on the dialect, and the compiler would be unable to refuse it on
the dialect where it is valid but wrong.

```
selectFrom('items').where('embedding', 'cosine', [0.1, 0.2])
=> text: SELECT * FROM "items" WHERE "embedding" <=> $1
   parameters: ['[0.1,0.2]']
```

All three are Postgres-only and refused on every other dialect at compile time, naming the operator and the dialect. The nearest-neighbour ordering that makes them useful
(`ORDER BY embedding <=> $1 LIMIT 10`) is represented by the closed `distance<T>(column, op, query)` expression. The same expression can be projected with `.as(alias)` or passed to `orderBy`. Every
query vector is encoded as pgvector text before it becomes a bound parameter; passing the raw JavaScript array would make node-postgres encode a PostgreSQL array (`{"0.1","0.2"}`), which pgvector does
not accept as vector input.

**PostGIS predicates are functions, not operators**, so they do not go in `OP_MAP` at all. They are a predicate kind of their own with a closed function set:

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

`ST_DWithin` is why `distance` is a field rather than an extra element of `value`: it is the one member with a third argument, it is a number rather than a geometry, and it is a parameter rather than
interpolated text.

A closed enum, again, because the function name is emitted unquoted and the whole point of a spatial predicate is that a caller supplies the geometry — the value — and never the SQL. The public
surface exposes the two predicates required by the extension guide, `stContains` and `stDWithin`; the lower-level closed renderer retains all four frozen matrix members.

## 5b. Write expressions (frozen — epic "Expression-valued writes")

`SET views = views + 1` needs no read, no version column and no retry loop, which is the whole reason this exists. But an expression on the write path is a second query language if it is allowed to
grow, so the vocabulary is closed and the rule that closes it comes before the list.

### 5b.1 The inclusion rule

A variant is **in** when, on every supported dialect, it compiles to a single expression that

1. references **exactly one column**, the one being assigned,
2. binds **at most one parameter**, and
3. consists entirely of tokens the emitter owns — no caller text reaches the SQL, and
4. means the **same thing** on every supported dialect for non-null operands; any dialect-specific null behavior is explicit in §5b.5.

It is **out** when it needs a second column reference, a subquery, a statement rewrite, or any token the caller supplies.

Rule 4 is separate from rule 3 on purpose, and it is the one that does the work. The tempting version of this rule is "one operator token per dialect", and it is wrong in both directions:

- It would exclude `concat`, which needs `CONCAT(…)` on MySQL because `||` there is logical OR unless `PIPES_AS_CONCAT` is set — so the operator spelling on MySQL does not fail, it evaluates to `0` or
  `1` and writes that. A function call is still one emitter-owned expression over one column, so `concat` is in.
- It would admit **division**, which is one token everywhere and multiple results. Integer `/` truncates on the Postgres family, SQLite and SQL Server and yields a decimal on the MySQL family, while
  division-by-zero behavior also differs. One declaration, several answers, so there is no `div` variant and there will not be one.

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

**There is no `column` field, and its absence is the design.** The column is the key of the `set()` object: `set({ views: inc(1) })` increments `views`. Two things follow, and both were the reason for
dropping the field rather than making it optional.

A cross-column reference — `SET a = b + 1` — becomes _unrepresentable_ rather than merely undocumented, so the non-goal in §5b.6 is enforced by the type instead of by a review comment.

And no column name ever arrives as data on this path, so the identifier-from-caller problem that `opclass` and `IndexMethod` each had to solve separately does not exist here at all.

**The runtime brand is a symbol, and the emitter tests for the symbol — never for `'op' in value`.** A `json` column can legitimately hold `{ op: 'add', by: 1 }`; that is somebody's stored document,
and duck-typing would compile their data into SQL. The symbol also cannot survive `JSON.parse`, so a `ColumnExpr` is unforgeable from a request body — a property §3b of `../repository/SPEC.md` leans
on rather than re-establishing.

The `PHANTOM` field is type-only and exists to pin `T`. Without it, `{ op: 'not' }` mentions `T` nowhere, so it is a member of `ColumnExpr<number>` as much as of `ColumnExpr<boolean>` and
`set({ views: not() })` would type-check. With it, `ColumnExpr<boolean>` is assignable to no other instantiation. The type-test:

```ts
// @ts-expect-error not() is boolean-only; views is a number
qb.updateTable('posts').set({ views: not() });
// @ts-expect-error inc() is numeric; published is a boolean
qb.updateTable('posts').set({ published: inc(1) });
```

An entry in `set()` whose value does not carry the brand is bound as a parameter exactly as today, so every golden statement in §4 is unchanged.

### 5b.3 The SQL, per variant, per dialect

```
set({ views: inc(1) }).where('id', '=', 7)
postgres  UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2     parameters: [1, 7]
mysql     UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?       parameters: [1, 7]
sqlite    UPDATE "posts" SET "views" = "views" + ? WHERE "id" = ?       parameters: [1, 7]
mssql     UPDATE [posts] SET [views] = [views] + @p1 WHERE [id] = @p2   parameters: [1, 7]

set({ stock: dec(2) })
postgres  UPDATE "posts" SET "stock" = "stock" - $1                     parameters: [2]

set({ published: not() })
postgres  UPDATE "posts" SET "published" = NOT "published"              parameters: []
mysql     UPDATE `posts` SET `published` = NOT `published`              parameters: []
mssql     UPDATE [posts] SET [published] = ~[published]                  parameters: []

set({ title: concat(' (draft)') })
postgres  UPDATE "posts" SET "title" = "title" || $1                    parameters: [' (draft)']
sqlite    UPDATE "posts" SET "title" = "title" || ?                     parameters: [' (draft)']
mysql     UPDATE `posts` SET `title` = CONCAT(`title`, ?)               parameters: [' (draft)']
mssql     UPDATE [posts] SET [title] = CONCAT([title], @p1)              parameters: [' (draft)']

set({ nickname: coalesce('anonymous') })
postgres  UPDATE "users" SET "nickname" = COALESCE("nickname", $1)      parameters: ['anonymous']
```

`dec` emits `-` rather than `+` with a negated parameter, because `by` may be a `bigint` or a decimal string and negating it would be a per-type operation in JavaScript that the compiler has no
business doing.

The Postgres and MySQL families plus SQLite use `NOT`; on the MySQL family it evaluates a `tinyint(1)` to `1` or `0`, which is what the column stores. SQL Server uses bitwise `~` because a `BIT`
column is not a T-SQL boolean expression. `SET` parameters precede `WHERE` parameters, as they already do.

### 5b.4 `proposed`, and the MySQL spelling

`proposed()` is "the value this INSERT tried to write", and it is legal **only** inside `onConflict(...).doUpdate({...})`. Outside an upsert there is no proposed row, so a plain `update()` refuses it
naming that:

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
mssql     … WHEN MATCHED THEN UPDATE SET [hits] = src.[hits] …
```

The current-row reference on the right-hand side is the stored row on every dialect, so `inc` inside an upsert increments the row that was already there — the atomic-counter recipe, and the reason
`proposed` has to be a variant rather than the implicit meaning of a bare column. Postgres qualifies the proposed row with `EXCLUDED`; SQL Server qualifies both sides as `tgt` and `src` inside
`MERGE`.

**MySQL keeps `VALUES(col)`** — which is what the compiler already emits — and no minimum server version enters the contract. `VALUES()` in the `ON DUPLICATE KEY UPDATE` clause is deprecated as of
MySQL 8.0.20 in favour of a row alias (`INSERT … AS new … SET c = new.c`), but deprecated is not removed: it still works, and it works on servers older than 8.0.19 and on MariaDB, which never
implemented the alias form at all.

Emitting the alias would break two populations to silence a warning in one. If MySQL removes `VALUES()`, the emitter needs a server-version probe, and that is named here as future work rather than
built on speculation.

### 5b.5 Nullability, and the one place the vocabulary bites

Arithmetic and `not` are null-propagating on all six dialects: `NULL + 1` and `NOT NULL` produce `NULL`. Concatenation is the exception: SQL Server's `CONCAT(NULL, 'x')` produces `'x'`, while the
Postgres and MySQL families and SQLite preserve `NULL`. So:

- On a `NOT NULL` column the current value cannot be null, and `add`/`sub`/`mul`/`not` cannot produce one.
- `coalesce` with a non-null fallback cannot produce null at all, which is the only variant that is safe regardless of the column.
- `concat` with a nullable column preserves null on the Postgres and MySQL families and SQLite but treats it as an empty string on SQL Server. The MySQL family and SQL Server both use their native
  `CONCAT` function but assign different meaning to a null operand, so callers that need portable null preservation must handle it outside this closed expression.

**`inc` on a nullable numeric column yields NULL, not `by`.** This is the classic surprise, and zmdb does not wrap it in a `COALESCE` to be helpful: that would make `inc` mean two different things
depending on a column's nullability, and the author who wanted the wrapping cannot tell from the call site whether they got it.

The vocabulary cannot compose either — there is no way to say "coalesce then add" — so the answer is that a counter should be `NOT NULL DEFAULT 0`, which is what the column wanted anyway, and anything
beyond that is raw SQL. This is the closedness costing something, and it is accepted knowingly rather than discovered later.

One guarantee genuinely weakens: a `varchar` column's `Length<n>` bound is enforced on the value a DTO validates, and `concat` produces a value no validator sees. Postgres and SQLite raise on
overflow; MySQL **truncates silently** outside strict mode.

The check that would prevent it is `char_length(col) + char_length($1) <= n`, which is a predicate rather than an assignment and therefore out of this vocabulary. So the gap is stated: a `concat` onto
a length-bounded column is the one write where the declared bound is the database's business rather than zmdb's.

### 5b.6 Non-goals (rejected, and not to be relitigated)

- **Cross-column references.** `SET a = b + 1`. Unrepresentable by construction — there is no `column` field. Once a second column may be named, the SET clause needs scope resolution, and scope
  resolution is the general expression builder.
- **A general expression AST.** Nested operators, arbitrary functions, casts. That is a second query language with its own dialect table and its own escaping surface, living on the write path where a
  mistake is durable rather than merely wrong once.
- **Subqueries in `SET`.** `SET rank = (SELECT …)`. Needs a whole builder as an operand and re-opens parameter numbering across two statements' worth of placeholders.
- **`RETURNING` a computed value.** `RETURNING views + 1` is a projection, not an assignment; projections are the select path's problem and the two should not share a vocabulary by accident.
- **Division.** §5b.1, rule 4.

## 5c. Null predicates (frozen — epic "Entity filters and soft delete")

`OP_MAP` gains two entries, and they are the first zero-operand ones:

| `op`          | SQL           |
| ------------- | ------------- |
| `is null`     | `IS NULL`     |
| `is not null` | `IS NOT NULL` |

`compileWhere` binds **no** parameter for either, and a `value` passed alongside one is ignored rather than bound — a bound-but-unused parameter would shift the numbering of every placeholder after
it.

They are needed rather than convenient: a soft-delete filter is `deletedAt IS NULL`, and there was no way to say that. The alternative a caller reaches for without them is
`where('deletedAt', '=', null)`, which compiles to `"deletedAt" = $1` with a `null` parameter and **matches no rows at all** under SQL's three-valued logic.

That failure is silent and reads as an empty table rather than as a mistake, which is the worst possible shape for the one predicate that gets conjoined into every query (`../repository/SPEC.md` §3c).

## 5d. Cursors (frozen — epic "Streaming reads and query cancellation")

**Nothing in this package changes**, and that is the frozen answer rather than an omission. A cursor is connection lifecycle; a `CompiledQuery` is text and parameters. Teaching the compiler about
cursors would mean retaining per-query state, which §6 already rejects, and it would put a `DECLARE` in front of a statement whose transaction the compiler cannot see.

Three properties this package already has become **load-bearing** because the streaming driver embeds `text` verbatim in `DECLARE <name> CURSOR FOR <text>` (`../repository/SPEC.md` §1a):

- **`text` is exactly one statement, and carries no trailing semicolon.** Every golden in §4 shows this; it was cosmetic and now it is required, because a `DECLARE` prefixing a semicolon-terminated
  string is a syntax error and a `DECLARE` prefixing two statements would be something worse.
- **Placeholders start at `$1` and are numbered over the statement alone.** The `DECLARE` prefix binds nothing, so a driver can wrap the text without renumbering — the one thing that would have forced
  a compiler change if it were not already true.
- **Nothing the caller supplied reaches `text` unparameterised** (§5a, §5b.2), which is what makes wrapping it in another statement safe at all. A compiler that interpolated even identifiers from data
  would turn the cursor wrapper into an injection point one layer below where anybody would look for one.

Streaming does not want a rewritten query either. No implicit `ORDER BY` is added: a cursor over an unordered `SELECT` is as well-defined as the non-streaming version of the same read, and inventing
an ordering would change results silently and defeat any index the author chose. No implicit `LIMIT`, for the same reason — bounding a stream is what `batchSize` is for, and it bounds memory rather
than the result.

## 5e. The built-in dialect mechanism and injected seam (frozen — epic "The SQL dialect matrix")

The temporary built-in `Dialect` compatibility union has the frozen six-member set: `'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore'`. The per-dialect divergences, construct by
construct with the SQL written out, are in `src/dialects/SPEC.md`. What belongs here is the mechanism, because it changes how every section above is implemented.

**A traits record per dialect, with an optional `parent`, merged once at module load.** Not a flat union with more comparisons. The pre-mechanism measurement that decided it, preserved in
`src/dialects/SPEC.md` §1, found no `switch (dialect)`: fourteen inline comparisons across seven files, two `Record<Dialect, …>` tables, and eight emitters that produced one dialect's grammar with no
branch.

Adding three members then stopped exactly three files; the other twenty-one sites kept compiling and quietly emitted Postgres SQL for SQL Server. That ratio, three of twenty-four, is the argument for
the traits table.

The cost is not hidden: `quoting.ts` is built around a quote-character pair, `renumberPlaceholders` takes a dialect so named placeholders can be continued across a `UNION`, and `tailClause` delegates
to the resolved pagination trait. Cockroach and SingleStore now use that seam through their Postgres and MySQL parents, while SQL Server owns the named-part assembly for `OUTPUT` and `MERGE`; #507
supplied the shared dispatch seam.

The `returning` trait is a per-statement record rather than one boolean or one placement string. One renderer consults it for INSERT, upsert, UPDATE, and DELETE, which keeps MySQL refusals,
Postgres/SQLite suffixes, and SQL Server `OUTPUT` placement on the same declared axis.

Three things this mechanism does **not** change:

- **§1's contract.** A compiled query is still `{ text, parameters }`, still frozen, still a pure function of builder state. `parameters` stays positional and in placeholder order even where the
  dialect binds by name — the `mssql` driver adapter maps the array onto `@p1…@pn`, which is exactly what that ordering is for.
- **§3's table**, which describes the four root dialect rows. Cockroach and SingleStore inherit the Postgres and MySQL placeholder/quoting rows through resolved traits.
- **Dispatch timing.** Built-in `TRAITS` is resolved once when the compatibility module is evaluated. An injected `SqlDialect` is validated, resolved and frozen once when it is defined or extended;
  compiler helpers read its completed `traits` object and never walk a parent per statement. Exported helpers accept the object alongside temporary built-in names, and repositories cache the selected
  traits and capabilities at construction.

**One narrowing to §5d.** That section froze "`text` is exactly one statement, and carries no trailing semicolon" as load-bearing, because the streaming driver embeds `text` in
`DECLARE <name> CURSOR FOR <text>`. SQL Server's upsert is a `MERGE`, and `MERGE` requires a terminating semicolon. The invariant is therefore narrowed rather than broken: it holds for every `SELECT`,
which is all a cursor ever wraps. An upsert is not a `SELECT`, one statement it remains, and the semicolon is confined to that one construct.

**One sentence in §5b.3 changed with SQL Server.** "`NOT` is the same token on all three" was true of the original dialects. `NOT [published]` is a syntax error in T-SQL, where a `BIT` column is not a
boolean expression; the spelling is `~[published]`.

## 5f. The target seam (frozen — epic "Non-SQL targets")

`src/targets/SPEC.md` answers whether a non-SQL target — MongoDB, Gel — can be served without degrading the SQL path. Both targets are refused, for reasons that are about the data model rather than
the seam, and the part that belongs in this file is what the question turned up about the seam itself.

**`CompiledQuery` does not change, and the seam has already moved.** The DTO folders that build a query — `compileWhere`, `applyOrderBy`, `applyKeysetFilter`, `applyPagination`, all in
`@zmdb/schema-core/dto` — drive a builder through two structural interfaces, `WhereTarget` and `OrderTarget`, whose methods are `where(col, op, value)` and `orderBy(col, dir)` and which mention
neither SQL nor `CompiledQuery`. A non-SQL target is a builder factory implementing those plus its own `compile()`, executed by its own driver.

So §1's contract stands as written, `Driver` keeps taking a `CompiledQuery`, and the alternatives — a `Q` type parameter, or a discriminated union — are both rejected: the parameter reaches `WhereDTO`
through `SubqueryTarget` and therefore lands inside the `verify:instantiations` budget, and the union turns all 46 references to `CompiledQuery` into narrowing sites. `ARCHITECTURE.md` §2.6 settles it
— an abstraction that costs the SQL path anything is the wrong one, and the structural seam costs it nothing.

**One thing this file has been quietly wrong about.** §2's grammar presents an ordinary predicate list as a list. `predicateList` joins those predicates with each one's own connector and emits no
implicit parentheses, so the meaning of `[{a, AND}, {b, OR}, {c, AND}]` is still supplied by SQL precedence.

`PredicateGroup` is the narrow exception: repository filters use an explicit group node so a filter such as `(active OR admin)` stays conjoined with the caller's predicate in `WHERE` and with the key
equality in `JOIN ON`. This does not make the general DTO tree nested. An `OR` inside a user's `WhereDTO` still flattens inside keyset pagination, and a target with no operator precedence to inherit
still cannot consume that ordinary flat plan faithfully.

Nesting the whole predicate tree remains the fix and a precondition for any non-SQL target; the filter group is a bounded SQL-path correctness primitive, not that generalisation.

## 6. Non-goals / anti-patterns (rejected)

- No runtime type resolution (no reliance on schema types at runtime).
- No retained per-query metadata objects beyond the returned CompiledQuery.
- No implicit query building (`.where({obj})` object sugar) — explicit args only.

## 7. Tooling extraction (#626)

Schema lifecycle tooling moves to [`../migrations/SPEC.md`](../migrations/SPEC.md). The measured current move is 20 shipped/build-input files: the eight non-fixture files under `src/introspect`, the
three files under `src/migrations`, and nine reusable command/migration-file modules currently under `packages/zmdb/src/cli`.

This package retains 17 runtime SQL files and the generic database protocols frozen by the database vertical epic. It loses:

- `./introspect`;
- `./migrations`;
- `./migrations/runner`;
- `./migrations/embedded`; and
- the required `oxfmt` dependency.

There are no permanent forwarding owners. `@zmdb/migrations` depends on this package for query, quoting and database protocols; this package never depends on migrations, compiler or CLI. The SQL root,
builders and database-protocol subpaths therefore remain formatter-, filesystem- and compiler-free. #721/#728 own any temporary compatibility interval.
