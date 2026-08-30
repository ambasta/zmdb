# SPEC — Typed repository methods (frozen)

Epic #201. Wires the `@zmdb/schema-core/dto` layer into `BaseRepository<S>` so
reads/writes are **typed at the call site** from the bound schema `S` — not
`Record<string, unknown>`. Runtime behaviour is unchanged (no proxies, no
identity map, parameterized SQL, validation-before-write); this is primarily a
type-level contract plus the new `find`/`list` methods.

## 1. Typed read methods (#202/#203/#204)

```ts
abstract class BaseRepository<S extends CoreSchema<string>> {
  findById(id: unknown): Promise<Entity<S> | undefined>;
  findOne(where: WhereDTO<S>): Promise<Entity<S> | undefined>;
  find(where: WhereDTO<S>): Promise<readonly Entity<S>[]>;
  findAll(): Promise<readonly Entity<S>[]>;
  list(query?: ListDTO<S>): Promise<ListResult<Entity<S>>>;
}
```

Frozen behaviour:
- `findById` / `findAll` keep their current SQL; return type is now `Entity<S>`.
- `findOne(where)` and `find(where)` accept a typed **`WhereDTO<S>`** (per-column
  value-typed operator object; see the DTO spec) and compile it via
  `compileWhere` — replacing the old equality-only `Record<string, unknown>`.
  `findOne` adds `LIMIT 1`.
- `list(query)` composes `where` (compileWhere) + `orderBy` (applyOrderBy) +
  pagination (applyPagination, fetch `limit+1`) and returns a
  **`ListResult<Entity<S>>`** via `buildListResult` (`{ items, hasMore, … }`).
- `postSelect` still runs; results are plain objects cast to `Entity<S>`.
- Golden: `find({ role: 'admin' })` ⇒ `WHERE "role" = $1`; `list({ page:{limit:20} })`
  fetches 21 rows and sets `hasMore` by trimming.

> [!NOTE]
> The cast to `Entity<S>` is a **boundary assertion**: the driver returns
> `Record<string, unknown>` at runtime and we trust the SQL shape. This matches
> how Kysely/Drizzle type their results. No runtime re-validation on reads (that
> is a deliberate zero-overhead choice; validation happens on writes).

## 2. Typed create / update (#205/#206/#207)

```ts
create(dto: CreateDTO<S>): Promise<Entity<S>>;
update(id: unknown, patch: UpdateDTO<S>): Promise<Entity<S> | undefined>;
delete(id: unknown): Promise<boolean>;
```

Frozen behaviour:
- `create` accepts `CreateDTO<S>` (auto-increment omitted, defaulted optional),
  validates against the schema **before** any SQL (throws `ValidationError`,
  driver never called on invalid input), returns the inserted `Entity<S>`.
- `update` accepts `UpdateDTO<S>` (`Partial<CreateDTO<S>>`), validates, returns
  the updated `Entity<S>` or `undefined` if no row matched.
- `delete` unchanged (`boolean`).
- Existing runtime `validatePayload` logic is reused as-is; only the static
  signatures tighten.

## Acceptance
- Type-level (`expectTypeOf`) assertions: `findById`→`Entity<S>|undefined`,
  `find`/`findOne` accept `WhereDTO<S>` and return `Entity<S>`, `list`→
  `ListResult<Entity<S>>`, `create` accepts `CreateDTO<S>`→`Entity<S>`,
  `update` accepts `UpdateDTO<S>`.
- Runtime golden tests (via a fake recording driver) for `find`/`list` SQL +
  `hasMore` trimming, and create/update validation-before-SQL.
