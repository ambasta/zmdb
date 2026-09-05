Pagination controls how many rows come back and in what order. zmdb supports offset and keyset (cursor) pagination through three composable helpers in `@zmdb/schema-core/dto`, and `BaseRepository.list()` wires all three together for you.

Most application code should call [`list()`](./repository.html) and read `page.items` / `page.cursor` / `page.hasMore` — see [Cursor Pagination](./guide-cursor-pagination.html). This page is the layer underneath, for when you are paginating a hand-built query.

## The three helpers

| Helper                                               | Does                                                         | Does **not**               |
| ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| `applyOrderBy(qb, order, pkColumn?)`                 | emits `ORDER BY`; appends `pkColumn ASC` if `order` omits it | anything else              |
| `applyPagination(qb, page)`                          | emits the dialect's limit/offset tail                        | read `after` / `before`    |
| `applyKeysetFilter(qb, cursorValues, order, where?)` | emits the keyset `WHERE` predicate                           | emit `LIMIT` or `ORDER BY` |

The split matters: `applyPagination` takes a `PaginationSpec` whose type _includes_ `after` and `before`, and **silently ignores both**. Offset pagination is `applyPagination` alone; keyset pagination is `applyKeysetFilter` **plus** `applyPagination`.

## Offset pagination

```ts
import { applyOrderBy, applyPagination, buildListResult } from '@zmdb/schema-core/dto';

let qb = compiler.selectFrom('users');
qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }], 'id');
qb = applyPagination(qb, { limit: 21, offset: 40 }); // limit + 1

const rows = await driver.execute(qb.compile());
const result = buildListResult(rows, {
  limit: 20,
  orderBy: [{ column: 'createdAt', dir: 'desc' }, { column: 'id' }],
  pkColumn: 'id',
});
```

**SQL emitted:**

```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC LIMIT 21 OFFSET 40
```

On SQL Server the same ordered builder emits `OFFSET 40 ROWS FETCH NEXT 21
ROWS ONLY`. A paginated SQL Server query without `ORDER BY` is refused. The
repository's first-row reads add primary-key ordering before their implicit
limit, falling back to the declaration's first column when no key exists. A
hand-built query must call `.orderBy(...)` itself.

Fetch `limit + 1` and pass the real `limit` to `buildListResult`, which is how `hasMore` is derived without a count.

`applyOrderBy` takes an `OrderBySpec` — `{ column: PropertyKey; dir?: OrderDir }[]` — which your typed `OrderByDTO<S>` is structurally assignable to. That widening is deliberate, so no `as OrderByDTO<…>` cast is needed at the call site.

> [!IMPORTANT]
> `OFFSET n` makes the database produce and discard `n` rows. Deep pages get slow and no index fixes it. Prefer keyset pagination for anything a user scrolls.

## Keyset pagination

```ts
import { applyKeysetFilter, decodeCursor } from '@zmdb/schema-core/dto';

const order = [
  { column: 'createdAt', dir: 'desc' as const },
  { column: 'id', dir: 'asc' as const },
];

let qb = compiler.selectFrom('users');
qb = applyOrderBy(qb, order);
qb = applyKeysetFilter(qb, decodeCursor(cursor), order, { active: { eq: true } });
qb = applyPagination(qb, { limit: 21 });
```

**SQL emitted** — one `OR` branch per sort column, each pinning the preceding columns with `=`:

```sql
SELECT * FROM "users"
WHERE ("active" = $1 AND "createdAt" < $2)
   OR ("active" = $3 AND "createdAt" = $4 AND "id" > $5)
ORDER BY "createdAt" DESC, "id" ASC
LIMIT 21
```

Two things to read off that SQL:

- **Row-value syntax is not emitted.** `("createdAt", "id") < ($1, $2)` is equivalent and tidier, but it needs [raw SQL](./raw-sql.html); the expanded form is portable across every supported dialect.
- **Your `where` is replicated into every branch.** That is why `applyKeysetFilter` takes it as its fourth argument rather than leaving you to call `compileWhere` separately — a filter applied only once would be dropped from the second branch, which is the classic way a keyset query leaks rows past a tenant filter.

The cursor must contain a value for **every** column in `order`; a missing one throws `Invalid cursor: missing value for column "x"`. So changing a query's `orderBy` invalidates cursors already in the wild.

> [!NOTE]
> Keyset pagination needs a total order, which means the last sort column must be unique. Pass `pkColumn` to `applyOrderBy` and include the primary key in `order` — or use `list()`, which appends it for you.

## Cursor encoding

```ts
import { encodeCursor, decodeCursor } from '@zmdb/schema-core/dto';

const cursor = encodeCursor({ createdAt: '2024-01-15T10:00:00Z', id: 123 });
const values = decodeCursor(cursor); // throws on malformed input
```

`base64url` of the JSON payload, using `Buffer` where available and `btoa`/`atob` otherwise, so it works on Workers and in the browser.

> [!WARNING]
> A cursor is encoding, not authentication — anyone can decode, edit and replay one. Never let a cursor carry authorisation; keep the tenant and owner predicates in the `where` on every page. See [Authorization](./web-authorization.html).

## ListResult

```ts
interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number; // only if you pass it in
  readonly hasMore: boolean; // from the limit + 1 fetch
  readonly cursor?: string; // encoded from the last kept row
}
```

```ts
const result = buildListResult(rows, { limit: 20, orderBy, pkColumn: 'id' });
// rows.length === 21 → hasMore = true, items = rows[0..19], cursor = encodeCursor(last kept row's sort keys)
// rows.length <= 20  → hasMore = false, items = rows, cursor = undefined
```

`buildListResult` also applies `select` projection per item, so `items` matches the columns you asked for.

## Total count

`total` is opt-in and `list()` **never sets it** — a total is a second `COUNT(*)` query you run yourself and pass in:

```ts
const result = buildListResult(rows, { limit: 20, total: await countUsers(where) });
```

> [!TIP]
> Only ask for a total when the UI shows "page 3 of 24". On a large table the count is the expensive part of the request — see [Count rows](./guide-count-rows.html) for the estimate-instead options.

## Typed DTOs

```ts
type OffsetPage = { limit: number; offset?: number | undefined };

type PaginationDTO<S> =
  OffsetPage | { limit: number; after?: Partial<Entity<S>> | string; before?: Partial<Entity<S>> | string };
```

A cursor is either the opaque string from a previous page or a partial entity, so column names in the object form are checked against the schema. `before` is accepted by the type and is **not implemented** by `list()` — see the ToDo on [Cursor Pagination](./guide-cursor-pagination.html).

## Cross-links

- [Cursor Pagination](./guide-cursor-pagination.html) — the repository-level story
- [Read DTOs](./read-dtos.html) — the full DTO family
- [Repository](./repository.html) — CRUD with pagination
- [Query Compiler](./select.html) — builder details
