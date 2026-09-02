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
class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
```

That is the entire required body to obtain full validated CRUD.

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
