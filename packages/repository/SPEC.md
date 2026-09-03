# @zmdb/repository — Frozen Spec (Issue #25)

> Status: **FROZEN** for TDD. Implementation (#26–#29) must satisfy this spec.
> Targets: Node 26+, ESM, TS 7. Depends on schema-core, query-compiler, aot-validator.

## 1. Driver interface (injected)

```ts
interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
```

The repository never opens connections itself; a `Driver` is injected. Results are
plain objects — **no proxies, no identity map**.

## 2. BaseRepository surface

```ts
abstract class BaseRepository<S extends CoreSchema<string>> {
  constructor(driver: Driver);
  static readonly schema: CoreSchema<string>; // bound by subclass

  findById(id: unknown): Promise<Entity<S> | undefined>;
  findOne(where: Partial<Entity<S>>): Promise<Entity<S> | undefined>;
  findAll(): Promise<readonly Entity<S>[]>;
  create(payload: unknown): Promise<Entity<S>>; // validates CreateDTO<S>
  update(id: unknown, payload: unknown): Promise<Entity<S> | undefined>; // UpdateDTO<S>
  delete(id: unknown): Promise<boolean>;
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

Every keyed method takes `PrimaryKeyOf<T>`, and that type already has both shapes: a scalar
for a one-column key, `{ [K in key columns]: value }` for a key with two or more. The
repository's job is to accept exactly what the type describes and to fail loudly on anything
else, because the failure it replaces was a query on half a key — which returns _a_ row, so
it looks like a hit.

```ts
findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
update(id: PrimaryKeyOf<T>, payload: unknown): Promise<Entity<T> | undefined>;
delete(id: PrimaryKeyOf<T>): Promise<boolean>;
```

All three build their `WHERE` from `schema.primaryKey` — the ordered list, never
`primaryKey[0]`. `pkColumn` (the private getter that returns `primaryKey[0]`) is the shape
this replaces: it is correct for a one-column key and quietly wrong for every other, and it
must not survive as a fallback.

The rules, in the order they are checked:

- **No key at all** (`primaryKey` is `[]`) — throws, naming the table. A keyless table is a
  legal schema (see `schema-core/src/ir/SPEC.md` §4.1) and these three methods simply do not
  apply to it.
- **One column** — the argument is the value, and it is used as-is. `{ id: 1 }` is _not_
  accepted as a courtesy: a one-column key that takes both forms is how code that will break
  on the day the key gains a column gets written.
- **Two or more** — the argument must be a non-null, non-`Date` object with **every** key
  column present and not `undefined`. Extra keys are ignored, because the caller may
  reasonably pass a whole entity.

A missing column throws `ValidationError` before any SQL is compiled, and the message names
the columns that were missing rather than saying the shape was wrong:

```
memberships.findById requires every key column; missing: user_id
memberships.findById requires every key column; missing: org_id, user_id
```

Missing columns are listed in key order, so the message is stable for a given call rather
than depending on object iteration order. A non-object argument for a composite key gets the
same class and a message that says what was passed instead:

```
memberships.findById requires every key column; got a number, expected an object with (user_id, org_id)
```

The method name in the message is the method the caller actually called — `findById`,
`update`, `delete` — not the private helper, because the helper is not in the caller's
vocabulary.

`update` and `delete` also mean the key columns are not writable through a payload: a patch
that names a key column is already refused by §3's "a key the variant does not accept is an
issue naming that key" rule, and `UpdateDTO` drops the whole key rather than its first
column.

## 3. Validation interception

- `create(payload)` validates against `CreateDTO<S>` before compiling INSERT.
- `update(id, payload)` validates against `UpdateDTO<S>` before compiling UPDATE.
- Invalid payload throws a structured validation error and **no SQL is executed**
  (driver.execute is not called).
- The check is the DTO's own type: `objectTypeFromShape(shapeOfVariant(ir, variant))`
  from `@zmdb/schema-core/ir`, walked by `@zmdb/aot-validator/utilities`. So a write
  enforces the same bounds (`Min`, `Max`, `Pattern`, `maxLength`) and the same nullability
  as the published document and the emitted validator, rather than a looser check of its
  own — this package no longer has a walker.
- The **app** layer, not the wire layer: a `timestamp` column wants a `Date` here. An
  ISO-8601 string is what arrives in a request body, and the web pipeline decodes it
  before a repository sees it.
- A key the variant does not accept is an issue naming that key, not a key to drop:
  an unknown column, a database-generated column on insert, or a primary key in a patch
  (REQ-RP-3). A key whose value is `undefined` means "not supplied" and is ignored.

## 3a. The app↔db crossing (both directions)

- Rows leave a driver in their **storage** form, which differs per dialect: `pg` hands back
  a `Date` for `TIMESTAMPTZ` and a string for `int8`, `node:sqlite` a string for `TEXT` and
  a number for `INTEGER`. Every row the repository returns is walked through
  `decodeDbValue` so `Entity<S>` holds one form regardless of driver — a `Date` for a
  `timestamp`, a `bigint` for a `bigint`.
- The walk reads what arrived rather than what the dialect is, so it needs no dialect
  table, and it is skipped entirely (`dbDecodedColumns`) for a schema with no such column.
- The other direction belongs to the driver, which knows what its client binds: the
  `node:sqlite` adapter binds a `Date` as ISO-8601 UTC, matching the `TEXT` the DDL emitter
  declares and keeping lexicographic order chronological, while `pg` binds a `Date` itself.

## 3b. Expression-valued writes (frozen — epic "Expression-valued writes")

`update` accepts a `ColumnExpr` in place of a value, per column, using the closed vocabulary in
`../query-compiler/SPEC.md` §5b:

```ts
update(id: PrimaryKeyOf<T>, payload: { readonly [K in keyof UpdateDTO<T>]?: SetValue<UpdateDTO<T>[K]> }): …;
await posts.update(7, { views: inc(1), published: not() });
```

**`create` refuses every variant.** Not as a policy but because there is nothing for the expression to read:
`INSERT INTO "posts" ("views") VALUES ("views" + 1)` is a reference to a column of a row that does not exist
yet, and Postgres rejects it with `column "views" does not exist`. The refusal names the column and says so,
rather than letting the database produce that message about SQL the caller never wrote. The one expression
that is legal on an `INSERT` is `proposed()`, and it lives in the upsert's update branch, which is an update.

### The validation rule

§3 validates a payload against the DTO's own type before any SQL is compiled. An expression is not a value
of the column's type, so the per-key check splits:

- A plain value is validated exactly as today.
- A branded `ColumnExpr` **exempts that column from the row-level check** and its operand is validated
  instead, against the column's own app type. So `inc` on a `bigint` column requires a `bigint` and rejects
  a `number`, the same way writing a plain value there does — one map, not a second looser one for
  operands.
- `not` and `proposed` have no operand and nothing to check at runtime; both are constrained at the type
  level (`../query-compiler/SPEC.md` §5b.2).
- `concat`'s `with` must be a string. Its result is not length-checked, and §5b.5 says why in the one place
  that matters.

The exemption is narrow on purpose: it applies to the key carrying the expression and to nothing else, so a
payload of `{ views: inc(1), email: 'not-an-email' }` still fails on `email`.

**An expression cannot arrive from a request body**, so this does not widen the input surface. The brand is a
`unique symbol` property and `JSON.parse` cannot produce one, which means a `ColumnExpr` is only ever
constructed by code that imported `inc`. That is deliberate and it is the difference between this and the
gap `compileWhere` has: an attacker who posts `{"views":{"op":"add","by":1000000}}` gets a plain object, and
a plain object on a numeric column is a validation failure, not an expression.

The keys an expression may not name are unchanged from §3: a primary key column is still refused in a patch,
so `{ id: inc(1) }` fails on the key rule before the expression rule is reached.

## 3c. Entity filters and soft delete (frozen — epic "Entity filters and soft delete")

A filter is a predicate the repository conjoins into **every** query it compiles. That makes it the
highest-leverage piece of SQL in the system, so the shape is constrained before the behaviour.

```ts
export interface FilterDef<P = void> {
  readonly name: string;
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

**`where` returns predicates, never SQL text.** Two reasons and the second one is mechanical. A filter is
applied to every statement, so a raw string there is not one injection point but all of them at once. And
a fragment carrying its own `$1` would collide with the numbering of the statement it is spliced into —
the compiler numbers placeholders across the whole query, and a filter is appended after the caller's
predicates, so a hand-written fragment is wrong for every query except the first one it was tested
against.

Soft delete is declared instead of registered, as a tag, and lives in the IR
(`../schema-core/src/ir/SPEC.md` §4.4): it is a property of the table, it needs no parameters, and three
other code paths need to know about it. A parameterised filter cannot go there — the IR is serialised to
a file for the AOT route and a function does not survive that.

### The read rule

Every read is filtered, and the list is written out because these are the paths that get forgotten:
`findById`, `findOne`, `findAll`, `count`, `exists`, every aggregation, and the second query of a
`populate`. `findById` included — a soft-deleted row is **not** findable by its id, which is the entire
point rather than an edge case.

`driver.execute` is not filtered and cannot be. zmdb does not parse the SQL a caller wrote, so raw SQL is
outside the boundary; the spec says so plainly rather than leaving the impression that a filter is a
property of the database.

### The join rule, per relation kind

The invariant, stated first because it decides both cases: **a filter on a target table never changes
which parent rows are returned.** A filter says which rows of _its own_ table are visible; silently
deleting a post because its author was soft-deleted is a different statement and not one anybody made.

**To-many** — the batched second query, and the easy case. The filter conjoins that query's `WHERE`:

```
populate(['posts']) with posts soft-deletable
SELECT * FROM "posts" WHERE "userId" IN ($1, $2) AND "posts"."deletedAt" IS NULL
```

The parent rows are already fetched and untouched; a parent whose children are all filtered out gets `[]`,
which is a legal value of the relation. The no-parent-keys case stays `WHERE 1 = 0` with no filter
appended — `1 = 0 AND …` adds nothing and the existing golden does not move.

**To-one** — the single-query join, and the case with a real decision in it. A to-one populate of a
**filtered** target becomes a `LEFT JOIN` with the filter **in the `ON` clause**:

```
posts.populate(['author']) with users soft-deletable
SELECT * FROM "posts" LEFT JOIN "users"
  ON "posts"."userId" = "users"."id" AND "users"."deletedAt" IS NULL
```

Both halves of that are forced. `INNER JOIN` would drop the post, violating the invariant. And the filter
in a trailing `WHERE` instead of the `ON` turns the left join back into an inner one — the unmatched row
has `NULL` in `users.deletedAt`, and `NULL IS NULL` is true, so that particular predicate survives it, but
any other filter (`users.tenantId = $1`) would evaluate to `NULL` on the outer row and drop the post. A
rule that works for one predicate shape and not the others is not a rule, so it is the `ON` clause,
always.

The parent's own filters stay in the `WHERE`, because there is no outer row to preserve there.

A to-one populate of an **unfiltered** target keeps the `INNER JOIN` it emits today, so no existing golden
moves. Worth recording that this leaves a seam: `Populated<T, K>` already types a to-one as
`Entity<Target> | null`, and an `INNER JOIN` cannot produce that null — it drops the parent instead. The
filtered path is the first place the declared type is actually true. Making the unfiltered path agree is a
real fix and belongs to whoever owns `compilePopulate`, not to this epic.

`ManyToMany` throws at resolution (`../schema-core/src/relations/SPEC.md` §2), so there is no third case.

### The write rule

`appliesToWrites` defaults to **true**. The default has to be the one where forgetting it is not a breach:
an `update` or `delete` that ignores a tenant filter reaches another tenant's rows, and that is a security
bug rather than a surprising result. A filter that genuinely should not constrain writes says so.

Soft delete redefines `delete` rather than being filtered by it:

```
users.delete(7)
UPDATE "users" SET "deletedAt" = $1 WHERE "id" = $2 AND "deletedAt" IS NULL
```

`deletedAt IS NULL` in the `WHERE` is what makes a second `delete` return `false` instead of overwriting
the timestamp with a later one, which would move the record of when the row was deleted.

Two more methods, and their existence is the point:

- `hardDelete(id)` compiles a real `DELETE`. It is a separate method and **not**
  `delete(id, { filters: { softDelete: false } })`, because "show me deleted rows" and "destroy this row"
  are different intents and must not be the same spelling. An option that turns a reversible operation
  into an irreversible one is a footgun with a review-proof appearance.
- `restore(id)` sets `deletedAt` back to `NULL`. It runs with the soft-delete filter off by necessity — a
  soft-deleted row is the only thing it can act on — and this is the **one** place the framework disables
  a filter on the caller's behalf. Stated explicitly so it is not discovered as an inconsistency.

An `update` against a soft-deleted row matches nothing and returns `undefined`, by the read rule.

### Missing parameters

A filter declared with parameters and invoked without them **throws**, before any SQL is compiled:

```
filter `tenant` requires parameters (tenantId) and none were supplied; pass them per call —
findAll({ filters: { tenant: { tenantId } } }) — or disable it by name
```

It does not become `TRUE`, and it is not skipped. A filter that quietly stops applying when its parameter
is absent is precisely the leak this feature exists to prevent, and it leaks on the code path that is
hardest to test — the one where somebody forgot something.

`undefined` and `null` for a declared parameter are missing parameters, not SQL `NULL`. A filter builder
that let `undefined` through would emit `"tenantId" = NULL`, which matches no rows under three-valued
logic, and "no rows" reads as an empty result rather than as an error.

### Disabling

Per name, always: `{ filters: { softDelete: false } }`.

**`{ filters: false }` is rejected and is not in the type.** It is the one call that changes meaning
without being edited: reviewed when the table had one filter, it silently disables the second filter
somebody adds two years later, and nothing in the diff of that later change shows the call site. There is
no blanket form and no `disableAll`.

An unknown name in `filters` throws and lists the declared ones. A typo when disabling fails safe — the
filter stays on — but confusingly, since the caller believes they widened the query and got fewer rows
than they expected, so silence is the wrong response even though it is the safe one.

A filter that must **never** be disabled is not expressible, and that is deliberate. Any option the
application can pass, the application can pass by mistake, so a filter is not a security boundary; it is a
default. A boundary that has to hold against application code belongs in the database — see
`../query-compiler/src/schema-objects/SPEC.md` §6 for row-level security — and the spec says so rather
than implying that `appliesToWrites: true` is one.

### Confirming a filter was applied

The honest answer is the compiled SQL, so there is an API that hands it over:

```ts
interface RepositoryOptions {
  readonly onQuery?: (query: CompiledQuery, meta: { readonly filters: readonly string[] }) => void;
}
```

`meta.filters` is the names of the filters that were applied to that statement, and it exists because
reading `deletedAt IS NULL` out of a `WHERE` clause by eye is exactly the check that goes wrong under a
join — the predicate is present, in the wrong clause, doing nothing. A name list is assertable in a test;
a SQL string is assertable only against a golden that nobody updates carefully.

## 4. Lifecycle hooks (explicit, synchronous ordering)

`preInsert(row)`, `postInsert(row)`, `preUpdate(row)`, `postSelect(rows)`,
`preDelete(id)`. Hooks are optional overrides; no hidden change tracking.

## 4a. Calling a stored routine (frozen — epic "Stored procedures and functions")

There are two layers and the boundary between them is the whole point of this section: one compiles SQL and
knows nothing, one is typed and validates. Mixing them is how a routine call becomes a privilege
escalation.

### The SQL layer (`@zmdb/query-compiler`)

```ts
function callFunction(name: string, args: readonly unknown[]): CompiledQuery;
function callTableFunction(name: string, args: readonly unknown[]): CompiledQuery;
function callProcedure(name: string, args: readonly unknown[]): CompiledQuery;
```

```
callFunction('archive_old_orders', [cutoff])
postgres  SELECT "archive_old_orders"($1) AS "result"     parameters: [cutoff]
mysql     SELECT `archive_old_orders`(?) AS `result`       parameters: [cutoff]

callTableFunction('active_users', [orgId])
postgres  SELECT * FROM "active_users"($1)                 parameters: [orgId]

callProcedure('rebuild_search_index', [])
postgres  CALL "rebuild_search_index"()                    parameters: []
mysql     CALL `rebuild_search_index`()                    parameters: []
```

The fixed alias `AS "result"` is load-bearing. Postgres names an unaliased function-call column after the
function; MySQL names it after the whole expression text, so the key is
`` `archive_old_orders(?)` ``, placeholder included. Without the alias the row's shape depends on the
dialect and the caller cannot read it by a constant key.

`callTableFunction` is a separate function rather than a `setof` flag because the two produce different
shapes — one row of one column against a relation of many — and a boolean argument would make the call
site's result shape depend on a runtime value. `callProcedure` uses `CALL` on both dialects (Postgres 11+).
SQLite has no routines at all, so all three refuse there with the message in
`../query-compiler/src/schema-objects/SPEC.md` §8.3.

**These three are deliberately not generic.** The sketch this replaces had
`callFunction<Args, R>(name, args)`, and those parameters would be a lie: `name` is a string, TypeScript
cannot look up a routine by one, so `Args` and `R` would be whatever the caller asserted and the signature
would advertise a check that never happens. Arguments are `readonly unknown[]` and every one is **bound as a
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

`ArgsOf` maps each parameter's `type` through the same app-type map the columns use, so a `timestamp`
parameter takes a `Date` and a `bigint` parameter takes a `bigint` — one map, therefore a routine argument
and a column of the same declared type are the same TypeScript type, and nothing has to be remembered
twice. `ResultOf` reads `returns`: a scalar gives the app type, `'void'` gives `void`, and `setof: true`
gives `readonly T[]` with the compiled SQL coming from `callTableFunction`.

This works only because the declaration is a value with literal types — `as const satisfies RoutineDef` —
which is also what keeps the body and the signature in one object. The alternative the docs page raised,
parsing the SQL body at build time to recover a signature, is not done: the body's language is an open
string, so the parser would be per-language, and a signature recovered from a body cannot be checked
against anything.

The return value is decoded the same way a row is (§3a): a `Date` for a `timestamp`, a `bigint` for a
`bigint`, whatever form the driver handed back. A routine result that skipped that walk would be the one
value in the package whose type depends on which driver is installed.

### Argument validation is mandatory, and this is why

`call` validates the argument tuple against the parameter types **before** compiling anything, through the
same `objectTypeFromShape` / `@zmdb/aot-validator/utilities` path a write goes through in §3. It is not an
option and there is no flag to skip it.

A routine body is opaque text that zmdb never parses. So nothing in this system can know whether a
parameter reaches a dynamic `EXECUTE` inside the body, and binding the argument as a parameter — which the
SQL layer does — only protects the call boundary, not the inside of the routine. A body doing
`EXECUTE 'SELECT … ' || cutoff` re-opens injection somewhere zmdb cannot see, and the only place left to
check the value is before it is sent.

The stake is higher than for a table write. A routine frequently runs with definer rights, which turns "may
call this routine" into "may do whatever its owner may do" — so every argument is an argument to a
privileged program. zmdb refuses to emit definer rights for that reason
(`../query-compiler/src/schema-objects/SPEC.md` §8.8), but it cannot stop a DBA from creating one, and it is
the caller's side of the boundary that this package owns.

Two consequences follow and both are frozen:

- **A routine name must never come from a request.** `quoteIdentifier` makes a name safe as an _identifier_
  and does nothing about _which_ routine it selects; `callFunction(req.body.fn, …)` is a
  routine-selection vulnerability with perfectly quoted SQL. Names are literals or come from a declared set
  of `RoutineDef` values.
- **The untyped layer is not reachable from user input.** `callFunction` and friends take
  `readonly unknown[]` and validate nothing, which is correct for a layer whose job is to compile SQL, and
  is exactly the shape of the gap that exists one level up in `compileWhere`. Request-derived arguments go
  through `call`.

## 5. Non-goals (rejected)

- Identity map / unit-of-work auto-flush / proxy dirty-checking / lazy relations.
- `out` / `inout` routine parameters. Reading one back is a session-state operation on MySQL and a result
  row on Postgres, so one declaration would need two call shapes — see
  `../query-compiler/src/schema-objects/SPEC.md` §8.7.
