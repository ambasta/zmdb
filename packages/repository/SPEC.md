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

## 4. Lifecycle hooks (explicit, synchronous ordering)

`preInsert(row)`, `postInsert(row)`, `preUpdate(row)`, `postSelect(rows)`,
`preDelete(id)`. Hooks are optional overrides; no hidden change tracking.

## 5. Non-goals (rejected)

- Identity map / unit-of-work auto-flush / proxy dirty-checking / lazy relations.
