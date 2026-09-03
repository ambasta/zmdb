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
