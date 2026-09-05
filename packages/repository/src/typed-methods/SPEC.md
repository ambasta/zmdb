# SPEC — Typed repository methods (frozen)

Epic #201. Wires the `@zmdb/schema-core/dto` layer into `BaseRepository<T>` so reads/writes are **typed at the call site** from the declared table `T` — not `Record<string, unknown>`. There are still
no proxies or identity map; SQL stays parameterized and writes validate before execution.

## 1. Typed read methods (#202/#203/#204)

```ts
abstract class BaseRepository<T extends DeclaredTable> {
  findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
  findOne(where: WhereDTO<T>): Promise<Entity<T> | undefined>;
  find(where: WhereDTO<T>): Promise<readonly Entity<T>[]>;
  findAll(): Promise<readonly Entity<T>[]>;
  list(query?: ListDTO<T>): Promise<ListResult<Entity<T>>>;
}
```

Frozen behaviour:

- `findById` / `findAll` keep their current SQL; return type is now `Entity<T>`.
- `findOne(where)` and `find(where)` accept a typed **`WhereDTO<T>`** (per-column value-typed operator object; see the DTO spec) and compile it via `compileWhere` — replacing the old equality-only
  `Record<string, unknown>`. `findOne` adds `LIMIT 1`.
- `list(query)` composes `where` (compileWhere) + `orderBy` (applyOrderBy) + pagination (applyPagination, fetch `limit+1`) and returns a **`ListResult<Entity<T>>`** via `buildListResult`
  (`{ items, hasMore, … }`).
- `postSelect` still runs; results are plain objects cast to `Entity<S>`.
- Golden: `find({ role: 'admin' })` ⇒ `WHERE "role" = $1`; `list({ page:{limit:20} })` fetches 21 rows and sets `hasMore` by trimming.

> [!NOTE] The cast to `Entity<T>` is a **boundary assertion**: the driver returns `Record<string, unknown>` at runtime and we trust the SQL shape. This matches how Kysely/Drizzle type their results.
> No runtime re-validation on reads (that is a deliberate zero-overhead choice; validation happens on writes).

## 2. Typed create / update (#205/#206/#207)

```ts
create(dto: CreateDTO<T>): Promise<Entity<T>>;
update(id: PrimaryKeyOf<T>, patch: UpdatePatch<T>): Promise<Entity<T> | undefined>;
updateMany(where: WhereDTO<T>, patch: UpdatePatch<T>): Promise<number | undefined>;
increment<K extends NumericColumnOf<T>>(
  id: PrimaryKeyOf<T>,
  column: K,
  by?: Exclude<UpdateDTO<T>[K], null | undefined>,
): Promise<Entity<T> | undefined>;
delete(id: PrimaryKeyOf<T>): Promise<boolean>;
```

Frozen behaviour:

- `create` accepts `CreateDTO<T>` (auto-increment omitted, defaulted optional), validates against the schema **before** any SQL (throws `ValidationError`, driver never called on invalid input),
  returns the inserted `Entity<S>`.
- `update` accepts `UpdatePatch<T>`, which wraps each `UpdateDTO<T>` value in `SetValue`. Plain values keep the strict DTO check; a branded expression is removed from that object check and its operand
  is validated against the same column IR.
- `updateMany` applies one validated patch to every matching row.
- `increment` derives its column parameter from updatable numeric SQL columns, so text/boolean columns and number/bigint operand mismatches fail at the call site.
- `delete` unchanged (`boolean`).
- Expression validation does not widen `UpdateDTO` or its validator.

## Acceptance

- Type-level (`expectTypeOf`) assertions: `findById`→`Entity<T>|undefined`, `find`/`findOne` accept `WhereDTO<T>` and return `Entity<T>`, `list`→ `ListResult<Entity<T>>`, `create` accepts
  `CreateDTO<T>`→`Entity<T>`, `update`/`updateMany` accept `UpdatePatch<T>`, and `increment` accepts only `NumericColumnOf<T>`.
- Runtime golden tests (via a fake recording driver) for `find`/`list` SQL + `hasMore` trimming, create/update validation-before-SQL, strict expression operands, atomic SQLite increments, hook input,
  and MySQL SQL without unsupported `RETURNING`.

<!-- §2 create/update frozen: create(CreateDTO<T>)→Entity<T>, update(id,UpdatePatch<T>)→Entity<T>|undefined; plain DTO values and branded operands validate separately before SQL. -->
