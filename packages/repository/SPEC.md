# @zmdb/repository — Frozen Spec (Issue #25)

> Status: **FROZEN** for TDD. Implementation (#26–#29) must satisfy this spec. Targets: Node 26+, ESM, TS 7. Depends on schema-core, query-compiler, aot-validator.

## Issue #635 target ownership

The current package has 21 build-included TypeScript files and 10 export-map entries after the SQLite adapter moved to `@zmdb/sqlite`. Sixteen current files move to `@zmdb/orm`; PostgreSQL owns two,
SQL Server owns one, web owns the endpoint integration, and jobs owns the job-storage module. The compiler outbox file adds the seventeenth ORM-owned file in the complete 137-file map amended after
#656.

`@zmdb/orm` depends exactly on `@zmdb/schema`, `@zmdb/sql`, and `@zmdb/validator`. Concrete database clients, built-ins, web/jobs, compiler, migrations, and AI are not reachable. The old package and
every `@zmdb/repository/*` import are deleted rather than forwarded.

## 1. Driver interface (injected)

```ts
interface Driver<Name extends string = string> {
  readonly dialect?: SqlDialect<Name> | Dialect;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

The repository never opens connections itself; a `Driver` is injected. Results are plain objects — **no proxies, no identity map**.

`dialect` lets an adapter declare what it wraps, so a repository constructed without an explicit dialect takes the driver's value before the temporary Postgres default. A third-party driver can
provide one frozen `SqlDialect<Name>`; built-in string names remain accepted during extraction. The repository gives that same object to the compiler and caches its limits, retry codes, capabilities
and returning behavior once. `opts` and `stream` are §1a. This is the one interface third parties implement, so the additions remain optional and do not break an existing implementation.

## 1a. Streaming and cancellation (frozen — epic "Streaming reads and query cancellation")

This is the only epic that changes an interface third parties implement, so the shape is chosen for what it costs an existing driver, not for what is most convenient here.

```ts
export interface ExecuteOptions {
  readonly signal?: AbortSignal;
  /** Rows per round trip. A driver may clamp it; 0 or negative is refused. */
  readonly batchSize?: number;
}
```

Both additions to `Driver` are optional, and an adapter written against the old interface stays assignable: a one-parameter `execute(q)` is assignable to a two-parameter signature under TypeScript's
parameter-count bivariance, so every driver in the wild — and every one-line mock in this repo's tests — keeps compiling. That is deliberate rather than lucky, and it is why cancellation is a second
parameter to `execute` instead of a third method.

### The two tiers of abort, and why there is no capability flag

**Tier one, every driver, enforced here.** Before dispatching, the repository calls `signal.throwIfAborted()`. An already-aborted read never reaches the database.

**Tier two, opt-in, driver-side.** A driver that can reach the server on a second connection cancels the running statement. A driver that ignores `opts` gives tier one only, so the signal is
**advisory**: the promise rejects when the query finishes, not when the signal fires.

There is no `Driver.cancels?: boolean`. A capability flag is a claim the driver author has to remember to keep true, and the first time it is stale it lies in the direction that costs a timeout.

The observable difference between the tiers is _when_ the rejection arrives; both reject with the same value, and a caller that needs a bound on that has to impose it themselves. `stream` is different
— it is a method, so its presence is a fact rather than an assertion, which is exactly why capability detection here is `typeof driver.stream === 'function'` and never a flag.

An aborted operation rejects with the platform's own failure: `AbortSignal.throwIfAborted()` semantics, which means `signal.reason` when one was given and a `DOMException` named `AbortError`
otherwise. Not a zmdb error class — a caller already has `err.name === 'AbortError'` and `signal.aborted`, and a wrapper would only hide them.

**Abort is not a rollback.** Rows already yielded stay yielded, and a cancelled statement inside a transaction leaves that transaction open and in whatever state the server left it. Rolling back is
still the caller's, on the same terms as any other failed statement.

### `repo.stream()` — the consumer surface

```ts
interface StreamOptions extends ExecuteOptions {
  /** Refuse rather than buffer when the driver has no cursor. Default false. */
  readonly requireCursor?: boolean;
}

stream(where?: Partial<Entity<S>>, opts?: StreamOptions): AsyncIterable<Entity<S>> & AsyncDisposable;
```

The **driver** returns a plain `AsyncIterable`; the **repository** returns one that is also `AsyncDisposable`. Splitting it that way keeps the third-party bar at one method while the ergonomics live
in the layer that can guarantee them:

```ts
await using rows = repo.stream({ status: 'pending' }, { signal });
for await (const row of rows) …
```

`for await` already closes the iterator on `break`, `return` and `throw` — that is a language guarantee, not something a driver has to implement. What `await using` adds is the case `for await` cannot
see: an iterable held in a variable and abandoned without ever being iterated, or iterated in a loop in a different function that returns early.

The stream is **single-shot**. A second `[Symbol.asyncIterator]()` throws rather than opening a second cursor, because a cursor is not re-readable and the silent version of this does the work twice —
or, on a transaction's single connection, interleaves two cursors on it.

Rows cross `decodeDbValue` (§3a) one at a time rather than a batch at a time, so peak memory is one raw batch plus one decoded row. Reads are not validated, on this path as on every other (§3).

### Cleanup, and the leak that cannot be detected

`return()` on the iterator must close the cursor and release the connection, must be idempotent, and must not reject for a stream that was never started. A driver that closes on the last row and again
on `return()` is a driver that double-releases a pooled connection, which shows up as an unrelated query failing on a connection someone else now holds.

The leak that stays: an iterator obtained by hand and dropped. Nothing runs `return()` for it — `FinalizationRegistry` is not a guarantee, and a cursor holding a connection until GC decides to look is
worse than the pool exhaustion it becomes.

So the contract is that the connection is held until the iterator is closed, that `for await` and `await using` both close it, and that a consumer who steps the iterator manually owns calling
`return()`. Named as a real hazard rather than papered over, because the alternative is a driver-side timeout, which would kill legitimately slow consumers.

### No `stream` on the driver: buffer, and let the caller refuse

The fallback runs `execute` and yields from the array. It is clear about being a fallback in two ways that a `console.warn` would not be — a library writing to stderr is unsuppressible and, in
production, unread:

- The `onQuery` hook (§3c) reports `{ buffered: true }` on the first fallback per driver, so an application that opted into observability learns that the capability is absent without receiving the
  same warning on every call.
- `requireCursor: true` throws instead, naming the driver's constructor and that it implements no `stream`. This exists because the failure mode of silent buffering is not "slower" — on the table
  somebody reached for a stream to read, it is the process dying — and a warning does not prevent that.

`batchSize` is meaningless in the fallback and ignored; the round trip already happened. Default `batchSize` is 100 where a cursor exists.

### Per-dialect cancellation

**Postgres** cancels out of band: `SELECT pg_cancel_backend($1)` on a _different_ connection, with the pid the streaming connection reported from `pg_backend_pid()`. Two consequences the bundled
adapter cannot dodge.

The pid has to be read on the same connection that runs the query, which means the stream must hold a checked-out connection rather than call `pool.query()` per statement — the same requirement the
cursor already imposes. And `PgQueryable` is deliberately minimal (`text`/`config` overloads only, no `connect()`), so `pgDriver` gets a second connection only if it is given one:

- `PgQueryable` gains an **optional** `connect?()`. When it is absent, `pgDriver` **omits `stream` from the object it returns**, so the repository's buffering fallback engages by the normal capability
  check instead of a cursor path that throws on first `next()`. Omitting beats throwing here: a driver that advertises a method it cannot honour turns a documented degradation into a crash.
- Cancellation additionally needs a connection that is _not_ the busy one. On a `Pool` that is any other member; on a bare `Client` there is none, and a `pg_cancel_backend` sent down the blocked
  socket queues behind the query it is meant to kill. `pg` exposes no way to tell the two apart through a structural type, so it is explicit: `pgDriver(client, { cancelVia })`, a second `PgQueryable`
  used for nothing but the cancel. Without it, abort is tier one plus "stop fetching further batches", which for a cursor is most of the value anyway.

**MySQL** is `KILL QUERY <id>` with the id from `CONNECTION_ID()`, on a second connection, under the same two constraints. **There is no bundled MySQL adapter**, so this is written for an implementer
rather than as a description of shipped code.

**SQLite** is synchronous and in-process.

`StatementSync.prototype.iterate()` exists on the supported Node, so `sqliteDriver` can implement a real `stream` that steps rows and checks the signal between them — but that is the whole of it.
`node:sqlite` exposes no `sqlite3_interrupt`, and no other JavaScript runs while a step is executing, so a single statement that takes ten seconds inside the engine (an unindexed `ORDER BY` over a
large table) is uninterruptible and abort is observed only after it returns.

Written down because "cancellation works on SQLite" and "abort stops the loop between rows" are different claims and only the second is true.

### The cursor is the driver's, and the compiler emits nothing new

No change to `@zmdb/query-compiler`. A `CompiledQuery` is text and parameters; a cursor is connection lifecycle, which the compiler has no access to and should not acquire — see its §6 non-goal on
retained per-query state.

The bundled Postgres adapter uses `DECLARE … CURSOR` with `FETCH FORWARD <batchSize>`, in an explicit transaction (Postgres closes a non-holdable cursor at transaction end), and `CLOSE` on cleanup —
rather than taking `pg-cursor` as a second optional peer dependency. Measured against PostgreSQL 16 through node-postgres 8.23.0, a parameterised `DECLARE … CURSOR FOR SELECT $1…` over the extended
query protocol binds and fetches the supplied values. The adapter therefore passes `query.parameters` to `DECLARE`; it never interpolates them into SQL.

### Inside a transaction

`withTransaction(tx)` re-instantiates the repository against a `txDriver`, so a stream on the transaction repository runs on the transaction's connection with no extra machinery. Two things it does
need:

- The forwarding is `execute: (q, opts) => tx.execute(q, opts)`, and `stream` forwards the same way. `stream` is **omitted** when the transaction object has none, by the rule above.
- **A stream must not outlive its transaction.** On scope exit, commit or rollback, the transaction closes every stream it handed out — `return()` on each, so a leaked cursor is released before the
  connection goes back to the pool rather than after. Any later `next()` rejects, naming the transaction rather than reporting a closed cursor from the driver. Both halves are required: cleanup keeps
  the pool correct, and the error keeps the consumer from reading a truncated result as a complete one.

A stream **outside** a transaction opens one for the cursor's lifetime on Postgres, because it has to. So a stream held open while its consumer does slow per-row work holds a transaction open, which
pins the vacuum horizon and is what `idle_in_transaction_session_timeout` exists to kill. This is an operational property of streaming, not a bug, and the answer to it is a smaller unit of work —
which is the next paragraph.

### What this does not replace

Keyset pagination already ships (`applyKeysetFilter`, `encodeCursor`/`decodeCursor`), and the two solve different problems. A stream is "walk every row once, now, with bounded memory, inside one
connection's lifetime". Keyset paging is "resume later, from another process, over a stateless request". A stream is **not resumable**: there is no token to hand a client, and the epic does not add
one. A read that has to survive a round trip to a browser is a keyset page and always was.

## 2. BaseRepository surface

```ts
abstract class BaseRepository<T extends DeclaredTable> {
  constructor(driver: Driver);
  static readonly schema: CoreSchema<string>; // bound by subclass

  findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
  findOne(where: WhereDTO<T>): Promise<Entity<T> | undefined>;
  findAll(): Promise<readonly Entity<T>[]>;
  create(dto: CreateDTO<T>, options?: CacheInvalidationOptions): Promise<Entity<T>>;
  update(id: PrimaryKeyOf<T>, patch: UpdatePatch<T>, options?: WriteOptions): Promise<Entity<T> | undefined>;
  updateMany(where: WhereDTO<T>, patch: UpdatePatch<T>, options?: WriteOptions): Promise<number | undefined>;
  delete(id: PrimaryKeyOf<T>, options?: WriteOptions): Promise<boolean>;
  deleteMany(where: WhereDTO<T>, options?: WriteOptions): Promise<number | undefined>;
  hardDelete(id: PrimaryKeyOf<T>, options?: WriteOptions): Promise<boolean>;
  restore(id: PrimaryKeyOf<T>, options?: WriteOptions): Promise<boolean>;
}
```

### <10-line subclass contract

```ts
class UserRepository extends BaseRepository<User> {
  static readonly schema = UserSchema;
}
```

That is the entire required body to obtain full validated CRUD.

### 2.1 Keys, single and composite (frozen — epic "Composite primary keys")

Every keyed method takes `PrimaryKeyOf<T>`, and that type already has both shapes: a scalar for a one-column key, `{ [K in key columns]: value }` for a key with two or more. The repository's job is to
accept exactly what the type describes and to fail loudly on anything else, because the failure it replaces was a query on half a key — which returns _a_ row, so it looks like a hit.

```ts
findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
update(id: PrimaryKeyOf<T>, payload: unknown): Promise<Entity<T> | undefined>;
delete(id: PrimaryKeyOf<T>): Promise<boolean>;
hardDelete(id: PrimaryKeyOf<T>): Promise<boolean>;
restore(id: PrimaryKeyOf<T>): Promise<boolean>;
```

The constructor records the ordered declared key from `schema.ir.primaryKey` and its physical counterpart from each column's `physicalName`. All five validate key objects in declared-property order
and emit every physical key predicate — never only `primaryKey[0]`.

The rules, in the order they are checked:

- **No key at all** (`primaryKey` is `[]`) — throws, naming the table. A keyless table is a legal schema (see `schema-core/src/ir/SPEC.md` §4.1) and these five methods simply do not apply to it.
- **One column** — the argument is the value, and it is used as-is. `{ id: 1 }` is _not_ accepted as a courtesy: a one-column key that takes both forms is how code that will break on the day the key
  gains a column gets written. It is a `ValidationError`, not silence: `{ [pkCol]: { id: 1 } }` is read as an operator map, no operator is found in it, and the predicate disappears rather than
  becoming wrong (#608). A value is a string, a number, a bigint, a boolean or a `Date`; anything else, including `null` and `undefined`, is refused with what arrived —
  `products.update requires the value of "id", not an object`.
- **Two or more** — the argument must be a non-null, non-`Date` object with **every** key column present and not `undefined`. Extra keys are ignored, because the caller may reasonably pass a whole
  entity.

A missing column throws `IncompleteKeyError`, a public `ValidationError` subclass, before any SQL is compiled. Its `table` and ordered `missing` fields are available to callers, and its message names
the columns that were missing rather than saying only that the shape was wrong:

```
memberships.findById requires every key column; missing: user_id
memberships.findById requires every key column; missing: org_id, user_id
```

Missing columns are listed in key order, so the message is stable for a given call rather than depending on object iteration order. A non-object argument for a composite key gets the same class and a
message that says what was passed instead:

```
memberships.findById requires every key column; got a number, expected an object with (user_id, org_id)
```

The method name in the message is the method the caller actually called — `findById`, `update`, `delete` — not the private helper, because the helper is not in the caller's vocabulary.

The ordered key list is copied once when the repository is constructed. `findById`, `update` and `delete` share one `keyWhere` compiler path; the same list is the default `upsert` conflict target and
the deterministic tie-breaker for `list` pagination.

### An unkeyed write is refused by the statement, not only by the key

`update` and `delete` derive their predicate from a key, so neither has a legitimate unkeyed form and a compiled `UPDATE`/`DELETE` whose text has no `WHERE` is always a bug. Both check the compiled
statement for one and throw a `ValidationError` — `refusing to update every row of products: the compiled statement has no WHERE clause` — before the driver sees it.

This is deliberately redundant with the key rules above, and with `compileWhere`'s own refusals (`schema-core`'s `dto/SPEC.md` §1). The rules stop the arguments that were known to produce it; this
stops the outcome.

Every step of the path that produced #608 was correct on its own and the composition was not, and the cost of the next such composition is the whole table, so the check is worth one regular expression
per write. `{}` remains a legal `WhereDTO` for reads, which is why the refusal lives here rather than in the fold.

`update(id, {})` has nothing to set and answers with the current row. The key is still checked first, so the shortcut cannot become a second unguarded path and the message names `update` rather than
the read it delegates to.

`update` and `delete` also mean the key columns are not writable through a payload: a patch that names a key column is already refused by §3's "a key the variant does not accept is an issue naming
that key" rule, and `UpdateDTO` drops the whole key rather than its first column.

## 3. Validation interception

- `create(payload)` validates against `CreateDTO<T>` before compiling INSERT.
- `update(id, payload)` validates ordinary values against `UpdateDTO<T>` and validates branded expression operands against the same column IR before compiling UPDATE.
- Invalid payload throws a structured validation error and **no SQL is executed** (driver.execute is not called).
- The check is the DTO's own type: `objectTypeFromShape(shapeOfVariant(ir, variant))` from `@zmdb/schema-core/ir`, walked by `@zmdb/aot-validator/utilities`. So a write enforces the same bounds
  (`Min`, `Max`, `Pattern`, `maxLength`) and the same nullability as the published document and the emitted validator, rather than a looser check of its own — this package no longer has a walker.
- The **app** layer, not the wire layer: a `timestamp` column wants a `Date` here. An ISO-8601 string is what arrives in a request body, and the web pipeline decodes it before a repository sees it.
- A key the variant does not accept is an issue naming that key, not a key to drop: an unknown column, a database-generated column on insert, or a primary key in a patch (REQ-RP-3). A key whose value
  is `undefined` means "not supplied" and is ignored.

## 3a. The app↔db crossing (both directions)

- Rows leave a driver in their **storage** form, which differs per dialect: `pg` hands back a `Date` for `TIMESTAMPTZ` and a string for `int8`, `node:sqlite` a string for `TEXT` and a number for
  `INTEGER`. Every row the repository returns is walked through `decodeDbValue` so `Entity<S>` holds one form regardless of driver — a `Date` for a `timestamp`, a `bigint` for a `bigint`, and a number
  array for an extension vector even when pgvector's parser is absent and the driver returns text.
- The walk reads what arrived rather than what the dialect is, so it needs no dialect table, and it is skipped entirely (`dbDecodedColumns`) for a schema with no `timestamp`, `bigint`, or extension
  vector column. Only `timestamp` and `bigint` differ at the JSON wire layer; vectors are arrays there and in the app.
- The other direction belongs to the driver, which knows what its client binds: the `node:sqlite` adapter binds a `Date` as ISO-8601 UTC, matching the `TEXT` the DDL emitter declares and keeping
  lexicographic order chronological, while `pg` binds a `Date` itself.

## 3b. Expression-valued writes (frozen — epic "Expression-valued writes")

`update`, `updateMany`, and the update branch of `upsert` accept a `ColumnExpr` in place of a value, per column, using the closed vocabulary in `../query-compiler/SPEC.md` §5b. `increment` is the
numeric-column-only convenience over the same path:

```ts
type UpdatePatch<T extends DeclaredTable> = {
  readonly [K in keyof UpdateDTO<T>]?: SetValue<UpdateDTO<T>[K]>;
};

update(id: PrimaryKeyOf<T>, patch: UpdatePatch<T>): Promise<Entity<T> | undefined>;
updateMany(where: WhereDTO<T>, patch: UpdatePatch<T>): Promise<number | undefined>;
increment<K extends NumericColumnOf<T>>(
  id: PrimaryKeyOf<T>,
  column: K,
  by?: Exclude<UpdateDTO<T>[K], null | undefined>,
): Promise<Entity<T> | undefined>;

await posts.update(7, { views: inc(1), published: not() });
await posts.increment(7, 'views');
```

**`create` refuses every variant.** Not as a policy but because there is nothing for the expression to read: `INSERT INTO "posts" ("views") VALUES ("views" + 1)` is a reference to a column of a row
that does not exist yet, and Postgres rejects it with `column "views" does not exist`.

The refusal names the column and says so, rather than letting the database produce that message about SQL the caller never wrote. The one expression that is legal on an `INSERT` is `proposed()`, and
it lives in the upsert's update branch, which is an update.

### The validation rule

§3 validates a payload against the DTO's own type before any SQL is compiled. An expression is not a value of the column's type, so the per-key check splits:

- A plain value is validated exactly as today.
- A branded `ColumnExpr` **exempts that column from the row-level check** and its operand is validated instead, against the column's own app type. So `inc` on a `bigint` column requires a `bigint` and
  rejects a `number`, the same way writing a plain value there does — one map, not a second looser one for operands.
- `not` and `proposed` have no operand and nothing to check at runtime; both are constrained at the type level (`../query-compiler/SPEC.md` §5b.2).
- `concat`'s `with` must be a string. Its result is not length-checked, and §5b.5 says why in the one place that matters.

The exemption is narrow on purpose: it applies to the key carrying the expression and to nothing else, so a payload of `{ views: inc(1), email: 'not-an-email' }` still fails on `email`.

**An expression cannot arrive from a request body**, so this does not widen the input surface. The brand is a `unique symbol` property and `JSON.parse` cannot produce one, which means a `ColumnExpr`
is only ever constructed by code that imported `inc`. That is deliberate and it is the difference between this and the gap `compileWhere` has: an attacker who posts
`{"views":{"op":"add","by":1000000}}` gets a plain object, and a plain object on a numeric column is a validation failure, not an expression.

The keys an expression may not name are unchanged from §3: a primary key column is still refused in a patch, so `{ id: inc(1) }` fails on the key rule before the expression rule is reached.

### Return values, SQL Server and MySQL

The Postgres family and SQLite return expression-bearing `update`/`increment` calls through `RETURNING`; SQL Server uses `OUTPUT INSERTED`. When physical and declared names differ, each returned
physical column is aliased to its declared property key. `updateMany` returns the number of rows the database returned from the dialect's row-returning clause (physical primary-key columns when
present).

The MySQL family has no `UPDATE … RETURNING`. The repository therefore emits no `RETURNING` for an expression-bearing keyed update or upsert update branch, and for every `updateMany`; those calls
execute one atomic statement and resolve to `undefined`. There is no hidden follow-up `SELECT`.

The methods whose public contract requires a returned entity take the other honest branch. MySQL-family `create`, an ordinary value-bearing keyed `update`, and an ordinary `upsert` refuse before
driver execution with `UnsupportedFeatureError('returning', dialect)`. The message names INSERT, UPDATE, or UPSERT and says to omit `returning()` and perform an explicit read. They do not drop the
clause and return `undefined`, because that would violate their declared return contract, and they do not invent a follow-up lookup whose key or connection affinity may be ambiguous.

## 3c. Entity filters and soft delete (implemented)

A filter is a predicate the repository conjoins into **every read** it compiles. That makes it the highest-leverage piece of SQL in the system, so the shape is constrained before the behaviour. Reads
and writes each pass through one compiler boundary, and both apply the same validated predicate definitions.

```ts
export interface FilterDef<P = void> {
  readonly name: string;
  /** Omit for this repository's table; set for a join or populate target. */
  readonly table?: string;
  /** Target schema used to validate its columns and parameter values. */
  readonly schema?: CoreSchema<string>;
  /** Conjoined with AND into the query's WHERE. Not a string — see below. */
  readonly where: (params: P) => readonly Predicate[];
  /** Applied unless explicitly disabled. Default true. */
  readonly enabled?: boolean;
  /** Also constrains UPDATE and DELETE. Default **true** — see the write rule. */
  readonly appliesToWrites?: boolean;
}

class UserRepository extends BaseRepository<User> {
  static readonly schema = UserSchema;
  static readonly filters = [tenantFilter] as const;
}

users.findAll({ filters: { tenant: { tenantId: ctx.tenantId } } });
users.findAll({ filters: { softDelete: false } });
```

**`where` returns predicates, never SQL text.** Two reasons and the second one is mechanical. A filter is applied to every statement, so a raw string there is not one injection point but all of them
at once.

And a fragment carrying its own `$1` would collide with the numbering of the statement it is spliced into — the compiler numbers placeholders across the whole query, and a filter is appended after the
caller's predicates, so a hand-written fragment is wrong for every query except the first one it was tested against.

A filter for another table carries that table's `CoreSchema`, unless the read itself accepts a `TaggedSchema` target. This is what lets the ordinary boundary validator check both the named column and
request-supplied parameter before compilation; a table name alone has no column types to validate against.

Soft delete is declared instead of registered, as a tag, and lives in the IR (`../schema-core/src/ir/SPEC.md` §4.4): it is a property of the table, it needs no parameters, and three other code paths
need to know about it. A parameterised filter cannot go there — the IR is serialised to a file for the AOT route and a function does not survive that.

### The read rule

Every read is filtered, and the list is written out because these are the paths that get forgotten: loader batches, `findById`, `findOne`, `find`, `findAll`, `list`, `count`, `exists`, full-text
reads, explicit joins, every aggregation, and the second query of a `populate`. `findById` included — a soft-deleted row is **not** findable by its id, which is the entire point rather than an edge
case.

`driver.execute` is not filtered and cannot be. zmdb does not parse the SQL a caller wrote, so raw SQL is outside the boundary; the spec makes this explicit instead of leaving the impression that a
filter is a property of the database.

### The join rule, per relation kind

The invariant, stated first because it decides both cases: **a filter on a target table never changes which parent rows are returned.** A filter says which rows of _its own_ table are visible;
silently deleting a post because its author was soft-deleted is a different statement and not one anybody made.

**To-many** — the batched second query, and the easy case. The filter conjoins that query's `WHERE`:

```
populate(['posts']) with posts soft-deletable
SELECT * FROM "posts" WHERE "userId" IN ($1, $2) AND "posts"."deletedAt" IS NULL
```

The parent rows are already fetched and untouched; a parent whose children are all filtered out gets `[]`, which is a legal value of the relation. The no-parent-keys case stays `WHERE 1 = 0` with no
filter appended — `1 = 0 AND …` adds nothing and the existing golden does not move.

**To-one** — the single-query join, and the case with a real decision in it. A to-one populate of a **filtered** target becomes a `LEFT JOIN` with the filter **in the `ON` clause**:

```
posts.populate(['author']) with users soft-deletable
SELECT * FROM "posts" LEFT JOIN "users"
  ON "posts"."userId" = "users"."id" AND "users"."deletedAt" IS NULL
```

Both halves of that are forced. `INNER JOIN` would drop the post, violating the invariant.

And the filter in a trailing `WHERE` instead of the `ON` turns the left join back into an inner one — the unmatched row has `NULL` in `users.deletedAt`, and `NULL IS NULL` is true, so that particular
predicate survives it, but any other filter (`users.tenantId = $1`) would evaluate to `NULL` on the outer row and drop the post.

A rule that works for one predicate shape and not the others is not a rule, so it is the `ON` clause, always.

The parent's own filters stay in the `WHERE`, because there is no outer row to preserve there.

A to-one populate of an **unfiltered** target keeps the `INNER JOIN` it emits today, so no existing golden moves. Worth recording that this leaves a seam: `Populated<T, K>` already types a to-one as
`Entity<Target> | null`, and an `INNER JOIN` cannot produce that null — it drops the parent instead. The filtered path is the first place the declared type is actually true. Making the unfiltered path
agree is a real fix and belongs to whoever owns `compilePopulate`, not to this epic.

`ManyToMany` throws at resolution (`../schema-core/src/relations/SPEC.md` §2), so there is no third case.

### The write rule

`appliesToWrites` defaults to **true**. The default has to be the one where forgetting it is not a breach: an `update` or `delete` that ignores a tenant filter reaches another tenant's rows, and that
is a security bug rather than a surprising result. A filter that genuinely should not constrain writes says so.

Soft delete redefines `delete` rather than being filtered by it:

```
users.delete(7)
UPDATE "users" SET "deletedAt" = $1 WHERE "id" = $2 AND "deletedAt" IS NULL
```

`deletedAt IS NULL` in the `WHERE` is what makes a second `delete` return `false` instead of overwriting the timestamp with a later one, which would move the record of when the row was deleted.

Two more methods, and their existence is the point:

- `hardDelete(id)` compiles a real `DELETE`. It is a separate method and **not** `delete(id, { filters: { softDelete: false } })`, because "show me deleted rows" and "destroy this row" are different
  intents and must not be the same spelling. An option that turns a reversible operation into an irreversible one is a footgun with a review-proof appearance.
- `restore(id)` sets `deletedAt` back to `NULL`. It runs with the soft-delete filter off by necessity — a soft-deleted row is the only thing it can act on — and this is the **one** place the framework
  disables a filter on the caller's behalf. Stated explicitly so it is not discovered as an inconsistency.

An `update` against a soft-deleted row matches nothing and returns `undefined`, by the read rule.

`delete` and `hardDelete` each run `preDelete(id)` exactly once. A soft delete does **not** run `preUpdate`, even though its SQL statement is an `UPDATE`: the caller invoked delete semantics, and hook
selection follows the repository operation rather than the SQL verb.

### Unique constraints and upsert

A full unique index still contains a soft-deleted row. `create({ email })` therefore receives the database's ordinary unique-constraint error when a deleted row already owns that email. Applications
that want a new live row instead need a partial unique index such as `CREATE UNIQUE INDEX users_email_live ON users(email) WHERE deleted_at IS NULL`; `IndexDef.where` represents that schema.

Repository `upsert` makes the other policy explicit: when its conflict target finds a soft-deleted row, the conflict update sets the managed column back to `NULL`, restoring that row while applying
the requested update fields. It does not return a still-hidden row. A partial-index conflict target has a different result—the deleted row is outside the index, so the statement inserts—but the
portable builder cannot spell a target predicate. PostgreSQL callers that need `ON CONFLICT (email) WHERE deleted_at IS NULL` use raw SQL until that target shape has a typed API.

### Missing parameters

A filter declared with parameters and invoked without them **throws**, before any SQL is compiled:

```
filter `tenant` requires parameters (tenantId) and none were supplied; pass them per call —
findAll({ filters: { tenant: { tenantId } } }) — or disable it by name
```

It does not become `TRUE`, and it is not skipped. A filter that quietly stops applying when its parameter is absent is precisely the leak this feature exists to prevent, and it leaks on the code path
that is hardest to test — the one where somebody forgot something.

`undefined` and `null` for a declared parameter are missing parameters, not SQL `NULL`. A filter builder that let `undefined` through would emit `"tenantId" = NULL`, which matches no rows under
three-valued logic, and "no rows" reads as an empty result rather than as an error.

### Disabling

Per name, always: `{ filters: { softDelete: false } }`.

**`{ filters: false }` is rejected and is not in the type.** It is the one call that changes meaning without being edited: reviewed when the table had one filter, it silently disables the second
filter somebody adds two years later, and nothing in the diff of that later change shows the call site. There is no blanket form and no `disableAll`.

An unknown name in `filters` throws and lists the declared ones. A typo when disabling fails safe — the filter stays on — but confusingly, since the caller believes they widened the query and got
fewer rows than they expected, so silence is the wrong response even though it is the safe one.

A filter that must **never** be disabled is not expressible, and that is deliberate. Any option the application can pass, the application can pass by mistake, so a filter is not a security boundary;
it is a default. A boundary that has to hold against application code belongs in the database — see `../query-compiler/src/schema-objects/SPEC.md` §6 for row-level security — and the spec says so
rather than implying that `appliesToWrites: true` is one.

### Confirming a filter was applied

The accurate answer is the compiled SQL, so there is an API that hands it over:

```ts
interface QueryMeta {
  readonly filters: readonly string[];
  /** §1a — a stream the driver could not cursor, served by buffering the whole result. */
  readonly buffered?: boolean;
}

interface RepositoryOptions {
  /** Schemas referenced by relations whose declared and physical names may differ. */
  readonly schemas?: readonly CoreSchema<string>[];
  readonly onQuery?: (query: CompiledQuery, meta: QueryMeta) => void;
}
```

`meta.filters` is the names of the filters that were applied to that statement, and it exists because reading `deletedAt IS NULL` out of a `WHERE` clause by eye is exactly the check that goes wrong
under a join — the predicate is present, in the wrong clause, doing nothing. A name list is assertable in a test; a SQL string is assertable only against a golden that nobody updates carefully.

`buffered` rides on the same hook rather than getting its own, because both answer one question — what did this call actually do, as opposed to what does it look like it did — and an application that
wired up one callback should not have to discover a second.

## 3d. Dataloaders and the result cache (frozen — epic "Dataloaders and the result cache")

Every part of this has a convenient version that is wrong, so each refusal is written down with its reason rather than left to be re-added later as an improvement.

```ts
export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number, tags: readonly string[]): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<void>;
}

export function memoryStore(options?: { readonly maxEntries?: number }): CacheStore;

export interface LoaderScope {
  loaderFor<T extends DeclaredTable>(repo: BaseRepository<T>): { load(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined> };
  relationLoader<T extends DeclaredTable, K extends RelationKeys<T>>(repo: BaseRepository<T>, relation: K): { load(parent: Entity<T>): Promise<Populated<T, K>[K]> };
}

export interface CacheOptions {
  readonly ttlMs: number;
  readonly tags?: readonly string[];
}

export interface ReadOptions {
  readonly cache?: CacheOptions | false;
  readonly filters?: FilterOverrides;
  readonly signal?: AbortSignal;
}

export interface CacheInvalidationOptions {
  readonly invalidateTags?: readonly string[];
}

export interface WriteOptions extends CacheInvalidationOptions {
  readonly filters?: FilterOverrides;
}

export interface RepositoryOptions {
  readonly cacheStore?: CacheStore;
  readonly filters?: readonly FilterDef<unknown>[];
  readonly schemas?: readonly CoreSchema<string>[];
  readonly onQuery?: (query: CompiledQuery, meta: QueryMeta) => void;
}
```

The root schema always contributes its constructor-time declared-to-physical map. `schemas` supplies relation targets so populate and relation joins can resolve their declared target identifiers
without a runtime naming strategy.

### The batching window is one microtask, and one batch is not one statement

The flush is scheduled with `queueMicrotask` on the first `load()` of an empty batch; every `load()` made before it runs joins.

Not `setTimeout(0)` and not `setImmediate`: a macrotask window batches strictly more and costs a full turn of the event loop on _every_ load, which in a resolver tree is one turn per level of nesting
whether or not anything was there to batch.

A longer window is not offered as an option, because the option's correct value depends on the shape of a request rather than on the application, so nobody can set it once and be right.

What this means at a call site, stated because it is the way the feature is most often defeated:

```ts
for (const id of ids) await loader.load(id); // n statements — the await flushes each batch
await Promise.all(ids.map(id => loader.load(id))); // one batch
```

**One batch is one dispatch, not one statement.** The batch reuses machinery that already ships: `sanitizeKeys` deduplicates and drops nullish keys, and `chunkArray` splits the ids to stay under the
dialect's placeholder ceiling. `wherein-chunking.spec.ts` pins that those chunks run **sequentially rather than concurrently**, so a batch of five thousand ids is `ceil(5000 / limit)` statements one
after another, not one statement and not five thousand concurrent ones.

Reusing that path rather than writing a second one is the point — a loader that built its own `IN` list would rediscover the placeholder limit in production.

`relationLoader(repo, relation)` uses the same window and scope for parents obtained at separate call sites. It resolves the declaration through the ordinary populate machinery, so parent keys are
deduplicated, target reads use the same sequential chunking, and the result has the declared cardinality: an array for to-many, a row or `null` for to-one. It is explicit; an ordinary `populate` does
not consult the scope.

### Scoping, and why a module-level loader is a security bug

A loader is created from a `LoaderScope` constructed **per request** and holds its own map. A module-level loader is refused, and the reason is not batching quality:

Loaders are consulted **before** a query is built, and entity filters (§3c) are applied **while** it is built. So a `load(42)` that hits an entry another request populated returns a row without the
tenant filter ever running. That is not stale data, it is a tenant-isolation bypass, and it is invisible in the diff of whatever code moved the loader to module scope for reuse.

The scope is **passed explicitly, not resolved from the DI container**. `@zmdb/app`'s `Scope` is `'singleton' | 'transient'` — there is no request scope — and both available registrations are wrong in
opposite directions: `singleton` is the module-level loader above, and `transient` hands out a fresh scope per injection, so two collaborators in one request batch nothing and the feature silently
does nothing at all.

A request scope in the container is a different epic; until it exists, the scope is constructed at the request boundary and threaded.

The scope is also the cache's lifetime bound. It holds no rows after the request, and there is no `clear()` to remember to call, because forgetting it is the leak.

### Result semantics

- `load(id)` for a row that does not exist resolves **`undefined`**, not a rejection. A missing row is an ordinary answer, and `findById` already answers it that way.
- A driver error **rejects every call in the batch** with that error. One statement failed; there is no per-id information to distinguish, and resolving some of them `undefined` would report "row
  absent" for a row nobody looked at.
- Duplicate ids in one batch fetch **one** row and resolve twice.

**Each resolution is a fresh shallow copy, and this is where the epic's boundary actually lives.** Two `load(42)` calls do not receive the same object. That is a deliberate reversal of the convenient
answer, and it is forced by decisions already frozen: `../schema-core/src/relations/SPEC.md` rejects "identity map / shared references", `src/replicas/SPEC.md` froze that the replica wrapper adds no
identity map, and `attachRelations` already gives each parent fresh child copies rather than aliases.

The published anti-patterns entry says it outright — zmdb returns a fresh value per read, equality is structural — so a loader handing out shared references would make that sentence false for the one
read path people use most.

The guarantee is "no two callers hold the same row object", **not** "no two callers can reach the same object": the copy is shallow, so a `json` column's parsed value is still shared. Deep-cloning
every row to defend against a mutation nobody performs is a cost paid on every read, and it is declined. The canonical entry in the loader's map is never handed out, so a caller mutating what they got
cannot corrupt what the next caller gets.

### What separates this from an identity map

Three properties, and all three have to hold:

1. **No identity guarantee.** Fresh copy per call, above.
2. **It is not consulted transparently.** `findById`, `findOne`, `findAll` and every populate path go to the driver even when a scope exists. The only way to read through a loader is to call `load` on
   one. A cache that other methods silently consult is an identity map with a different name, and it is where "why did I get the row from before my write" comes from.
3. **No write-through and no dirty tracking.** A write does not populate the loader's map, and nothing watches a returned row for changes. `update` takes a patch, as it always did.

### The cache key

```
z1 : dialect : fingerprint : table : filters : text : params
```

- **`dialect` and `text`** — the compiled SQL is what makes two different queries over the same parameters distinct, and the dialect is in the key because the same builder state compiles to different
  text and a shared store may be reachable from processes configured differently.
- **`fingerprint`** — the entity variant's IR fingerprint. This is what makes a shared store safe across a deploy: after a column's type changes, a value written by the old code **misses** rather than
  deserialising into a shape the new code does not expect. It costs nothing and it is total, which is why §"Re-validation" below can refuse the alternative.
- **`filters`** — the applied filter names and their parameter values, which is exactly the data §3c already computes for `onQuery`'s `meta.filters`. Without it, the same statement text cached with a
  filter disabled would be served to a call that expected it applied. The parameters are in `params` anyway; the **names** are the part that would otherwise be missing, because disabling a filter
  changes the text and re-enabling one with no parameters does not.
- **`params`** — serialised **type-tagged**, so `1`, `'1'`, `1n` and `true` are four keys: `n:1`, `s:1`, `i:1`, `b:true`, `z:null`, `u:` for `undefined`, `d:<epoch ms>` for a `Date`. Plain
  `JSON.stringify` collapses the first two and turns a `Date` into a string that a later ISO string would collide with.

**The key is a readable string and is not hashed.** Three reasons, in order of weight. A hash collision serves another query's rows, which is the worst failure this feature can produce, and a key that
cannot collide is better than one that probably will not. `node:crypto` is banned by this repo's lint config in favour of Web Crypto, whose `digest` is async, so hashing would make key construction
asynchronous for no benefit.

And a key that can be read in `redis-cli --scan` is the difference between diagnosing a stale read in minutes and guessing. A store that wants to hash internally is free to; that is its key space, not
this one's.

A composite primary key (§2.1) is serialised in **`ir.primaryKey` declaration order**, not object key order, so `{ tenantId, id }` and `{ id, tenantId }` are one key. A missing component throws rather
than keying on `undefined`.

### Invalidation is explicit, and the automatic part is a floor

A cached read carries the tags its caller named. Automatically, it also carries `table:<name>` for **every table the cached statement touched** — which the repository knows because it built the
statement, not by parsing SQL back out. A write through a repository method invalidates `table:<its own table>` and any `invalidateTags` the caller supplied with that write.

`docs-site/content/caching.md` argues that table-name granularity "is too coarse to be right and too fine to be safe", and that is a correct criticism of table names as an _inference_. The distinction
here is that the automatic tag set is derived from the statement rather than guessed from the repository, which answers the "too fine to be safe" half: a cached join over `users` and `posts` is
invalidated by a write to either.

The "too coarse to be right" half is **accepted and priced**: one row changing invalidates every cached read of its table, so this is a cache for read-mostly tables. A caller who needs better names
their own tags — `user:42` — and passes the same name in a write's `invalidateTags`, because they know which reads depend on that row and the framework does not.

Anything finer, automatically, requires deciding which cached `WHERE` clauses a new row satisfies. That is a query planner evaluating predicates against a row it does not have, and it is refused
rather than approximated, because an approximation here fails by serving data that is wrong rather than old.

**Two writes are invisible to invalidation, and TTL is the only bound on them**: raw driver traffic that did not go through a repository, and another process's writes against a shared store. Stated
because a cache whose invalidation is described without its blind spots reads as stronger than it is.

The driver wrapper on `caching.md` stays as the documented blunt instrument — it needs no repository, no scope and no tags, and it clears everything on any write, which is table granularity taken to
its limit. The two coexist deliberately: that wrapper is a decision about a whole connection, `ReadOptions.cache` is a decision about one call.

### Store lifetime, bounds and failure

No store is global or ambient. Supplying `RepositoryOptions.cacheStore` opts that repository into a caller-owned store; otherwise the first read with a `cache` option lazily creates a store owned by
that repository instance. An uncached repository never allocates one.

`memoryStore()` is TTL-aware LRU with a default bound of **1,000 entries**. `maxEntries` is a positive safe integer, and `ttlMs` is a positive finite duration. Reads refresh recency; insertion past
the bound evicts the least-recently-read entry. The bound is not derived from TTL: an unbounded map is still a leak while the entries are live.

A store error is an availability event, not a database error. A failed `get` falls through to the driver; failed `set` or `invalidateTags` calls are swallowed after the database operation succeeds.
The repository reports the first store failure once and stays quiet on subsequent failures from that instance. TTL remains the only stale-data bound when invalidation itself is unavailable.

### Re-validation: no, on both stores

A cached value is returned as it was stored until its TTL expires or a tag invalidates it. There is no read-through check against the database, and the rule does **not** differ between the in-memory
default and a shared store.

Re-validating means a round trip, which is the cost the cache exists to remove; that is an `ETag`, not a cache. And an asymmetry would be worse than either rule on its own, because staleness would
then depend on which store happens to be configured — tested against the in-memory default, shipped against Redis.

The concern behind the asymmetry is real and is answered structurally instead: the `fingerprint` segment of the key means another process's or another deploy's value cannot be deserialised into the
wrong shape, it simply is not found. A deliberately poisoned shared store is a compromised datastore, and per-read validation does not fix that — the same Redis holds the sessions.

`ttlMs` is therefore the caller's declared staleness tolerance and the only thing that bounds it. `cache: false` on a call bypasses the store in both directions, so it is also the answer to "read my
own write" without reaching for invalidation.

## 4. Lifecycle hooks (explicit, synchronous ordering)

`preInsert(row)`, `postInsert(row)`, `preUpdate(patch)`, `postSelect(rows)`, `preDelete(id)`. Hooks are optional overrides; no hidden change tracking.

`preUpdate` receives the validated patch that will be compiled: `undefined` properties are absent, accepted keys are rebuilt in schema order, ordinary values have passed the unchanged `UpdateDTO`
check, and branded expressions are the same objects the caller supplied after their operands passed the column's app-type check. It runs for `update`, `updateMany`, and `increment`. `upsert` continues
to run `preInsert` for its create payload; its conflict-update object does not also run `preUpdate`.

## 4a. Calling a stored routine (frozen — epic "Stored procedures and functions")

There are two layers and the boundary between them is the whole point of this section: one compiles SQL and knows nothing, one is typed and validates. Mixing them is how a routine call becomes a
privilege escalation.

### The SQL layer (`@zmdb/query-compiler`)

```ts
interface QueryCompiler {
  callFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
  callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
}
```

```
createQueryCompiler('postgres').callFunction('archive_old_orders', [cutoff])
postgres  SELECT "archive_old_orders"($1) AS "result"     parameters: [cutoff]
createQueryCompiler('mysql').callFunction('archive_old_orders', [cutoff])
mysql     SELECT `archive_old_orders`(?) AS `result`       parameters: [cutoff]

createQueryCompiler('postgres').callTableFunction('active_users', [orgId])
postgres  SELECT * FROM "active_users"($1)                 parameters: [orgId]

createQueryCompiler('postgres').callProcedure('rebuild_search_index', [])
postgres  CALL "rebuild_search_index"()                    parameters: []
createQueryCompiler('mysql').callProcedure('rebuild_search_index', [])
mysql     CALL `rebuild_search_index`()                    parameters: []
```

Cockroach inherits the Postgres call forms, including table functions. SingleStore inherits MySQL scalar-function and procedure calls, while its `RoutineDef` DDL is refused because that declaration
grammar diverges.

The calls are methods on the existing dialect-bound `QueryCompiler`. The original frozen sketch wrote them as top-level functions even though the same two-argument call was followed by different
Postgres and MySQL goldens; with no dialect input, both outputs cannot be true. Keeping the dialect on `createQueryCompiler` also makes the repository use the same compiler instance as its ordinary
queries instead of introducing a second dialect switch.

The fixed alias `AS "result"` is load-bearing. Postgres names an unaliased function-call column after the function; MySQL names it after the whole expression text, so the key is
`` `archive_old_orders(?)` ``, placeholder included. Without the alias the row's shape depends on the dialect and the caller cannot read it by a constant key.

`callTableFunction` is a separate function rather than a `setof` flag because the two produce different shapes — one row of one column against a relation of many — and a boolean argument would make
the call site's result shape depend on a runtime value. `callProcedure` uses `CALL` on both dialects (Postgres 11+). SQLite and SQL Server refuse all three calls. Table-function calls are limited to
the Postgres family; SingleStore retains only scalar-function and procedure calls through its MySQL wire grammar.

**These three are deliberately not generic.** The sketch this replaces had `callFunction<Args, R>(name, args)`, and those parameters would be a lie: `name` is a string, TypeScript cannot look up a
routine by one, so `Args` and `R` would be whatever the caller asserted and the signature would advertise a check that never happens. Arguments are `readonly unknown[]` and every one is **bound as a
parameter, never interpolated** — that much this layer does guarantee.

### The typed layer (this package)

The types come from the declaration, not from the call:

```ts
const archiveOldOrders = {
  kind: 'function',
  name: 'archive_old_orders',
  params: [{ name: 'cutoff', type: 'timestamp' }],
  returns: { type: 'integer' },
  language: 'plpgsql',
  body: '…',
} as const satisfies RoutineDef;

type ArgsOf<D extends RoutineDef> = …; // readonly [Date]
type ResultOf<D extends RoutineDef> = …; // number

class BaseRepository<S> {
  protected call<D extends RoutineDef>(def: D, args: ArgsOf<D>): Promise<ResultOf<D>>;
}
```

`ArgsOf` maps each parameter's `type` through the same app-type map the columns use, so a `timestamp` parameter takes a `Date` and a `bigint` parameter takes a `bigint` — one map, therefore a routine
argument and a column of the same declared type are the same TypeScript type, and nothing has to be remembered twice. `ResultOf` reads `returns`: a scalar gives the app type, `'void'` gives `void`,
and `setof: true` gives `readonly T[]` with the compiled SQL coming from `callTableFunction`.

This works only because the declaration is a value with literal types — `as const satisfies RoutineDef` — which is also what keeps the body and the signature in one object. The alternative the docs
page raised, parsing the SQL body at build time to recover a signature, is not done: the body's language is an open string, so the parser would be per-language, and a signature recovered from a body
cannot be checked against anything.

The return value is decoded the same way a row is (§3a): a `Date` for a `timestamp`, a `bigint` for a `bigint`, whatever form the driver handed back. A routine result that skipped that walk would be
the one value in the package whose type depends on which driver is installed.

`call` uses the repository's current driver. A repository returned by `withTransaction(tx)` therefore calls the routine on `tx`, not on the parent connection. The body remains opaque, so zmdb cannot
tell whether a procedure contains `COMMIT` or `ROLLBACK` and does not pretend to warn selectively. Keep a transaction-controlling procedure outside an outer transaction; a procedure that participates
in the caller's transaction can be invoked through the transaction-bound repository like any other statement.

### Argument validation is mandatory, and this is why

`call` validates the argument tuple against the parameter types **before** compiling anything, through the same `objectTypeFromShape` / `@zmdb/aot-validator/utilities` path a write goes through in §3.
It is not an option and there is no flag to skip it.

A routine body is opaque text that zmdb never parses. So nothing in this system can know whether a parameter reaches a dynamic `EXECUTE` inside the body, and binding the argument as a parameter —
which the SQL layer does — only protects the call boundary, not the inside of the routine. A body doing `EXECUTE 'SELECT … ' || cutoff` re-opens injection somewhere zmdb cannot see, and the only place
left to check the value is before it is sent.

The stake is higher than for a table write. A routine frequently runs with definer rights, which turns "may call this routine" into "may do whatever its owner may do" — so every argument is an
argument to a privileged program. zmdb refuses to emit definer rights for that reason (`../query-compiler/src/schema-objects/SPEC.md` §8.8), but it cannot stop a DBA from creating one, and it is the
caller's side of the boundary that this package owns.

Two consequences follow and both are frozen:

- **A routine name must never come from a request.** `quoteIdentifier` makes a name safe as an _identifier_ and does nothing about _which_ routine it selects; `callFunction(req.body.fn, …)` is a
  routine-selection vulnerability with perfectly quoted SQL. Names are literals or come from a declared set of `RoutineDef` values.
- **The untyped layer is not reachable from user input.** `callFunction` and friends take `readonly unknown[]` and validate nothing, which is correct for a layer whose job is to compile SQL, and is
  exactly the shape of the gap that exists one level up in `compileWhere`. Request-derived arguments go through `call`.

## 5. Non-goals (rejected)

- Identity map / unit-of-work auto-flush / proxy dirty-checking / lazy relations.
- `out` / `inout` routine parameters. Reading one back is a session-state operation on MySQL and a result row on Postgres, so one declaration would need two call shapes — see
  `../query-compiler/src/schema-objects/SPEC.md` §8.7.
