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

## 5. Non-goals (rejected)

- Identity map / unit-of-work auto-flush / proxy dirty-checking / lazy relations.
