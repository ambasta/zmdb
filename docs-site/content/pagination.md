Pagination controls how many rows come back and in what order. zmdb supports offset and keyset (cursor) pagination through three composable helpers in `@zmdb/orm/dto`, and `BaseRepository.list()`
wires all three together for you.

Most application code should call [`list()`](./repository.html) and read `page.items` / `page.cursor` / `page.hasMore` — see [Cursor Pagination](./guide-cursor-pagination.html). This page is the layer
underneath, for when you are paginating a hand-built query.

## The three helpers

| Helper                                               | Does                                                         | Does **not**               |
| ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| `applyOrderBy(qb, order, pkColumn?)`                 | emits `ORDER BY`; appends `pkColumn ASC` if `order` omits it | anything else              |
| `applyPagination(qb, page)`                          | emits the dialect's limit/offset tail                        | read `after` / `before`    |
| `applyKeysetFilter(qb, cursorValues, order, where?)` | emits the keyset `WHERE` predicate                           | emit `LIMIT` or `ORDER BY` |

For `mode: 'offset'`, `applyPagination` applies the limit and optional offset. For `mode: 'cursor'`, it applies the limit; decode and validate the token with `decodeCursor(token, order)`, then pass
those values to `applyKeysetFilter` to construct the boundary predicate.

## Offset pagination

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies compiler, driver; this excerpt does not repeat those declarations."}
import { applyOrderBy, applyPagination } from '@zmdb/orm/dto';
import { buildListResult } from '@zmdb/schema/dto';

let qb = compiler.selectFrom('users');
qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }], 'id');
qb = applyPagination(qb, { mode: 'offset', limit: 21, offset: 40 }); // limit + 1

const rows = await driver.execute(qb.compile());
const result = buildListResult(rows, { limit: 20 });
```

**SQL emitted:**

```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC LIMIT 21 OFFSET 40
```

On SQL Server the same ordered builder emits `OFFSET 40 ROWS FETCH NEXT 21 ROWS ONLY`. A paginated SQL Server query without `ORDER BY` is refused. The repository's first-row reads add primary-key
ordering before their implicit limit, falling back to the declaration's first column when no key exists. A hand-built query must call `.orderBy(...)` itself.

Fetch `limit + 1` and pass the real `limit` to `buildListResult`, which is how `hasMore` is derived without a count.

`applyOrderBy` takes an `OrderBySpec` — `{ column: PropertyKey; dir?: OrderDir }[]` — which your typed `OrderByDTO<S>` is structurally assignable to. That widening is deliberate, so no
`as OrderByDTO<…>` cast is needed at the call site.

> [!IMPORTANT] `OFFSET n` makes the database produce and discard `n` rows. Deep pages get slow and no index fixes it. Prefer keyset pagination for anything a user scrolls.

## Keyset pagination

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies applyOrderBy, applyPagination, compiler, cursor; this excerpt does not repeat those declarations."}
import { applyKeysetFilter } from '@zmdb/orm/dto';
import { decodeCursor } from '@zmdb/schema/dto';

const order = [
  { column: 'createdAt', dir: 'desc' as const },
  { column: 'id', dir: 'asc' as const },
];

let qb = compiler.selectFrom('users');
qb = applyOrderBy(qb, order);
qb = applyKeysetFilter(qb, decodeCursor(cursor, order), order, { active: { eq: true } });
qb = applyPagination(qb, { mode: 'cursor', limit: 21 });
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
- **Your `where` is replicated into every branch.** That is why `applyKeysetFilter` takes it as its fourth argument rather than leaving you to call `compileWhere` separately — a filter applied only
  once would be dropped from the second branch, which is the classic way a keyset query leaks rows past a tenant filter.

The token must describe the **exact** column sequence and directions in `order`, with one defined, non-null scalar value per column and no extra keys. `decodeCursor` validates this before SQL;
changing the effective `orderBy` invalidates existing tokens.

> [!NOTE] Keyset pagination needs a total order. Include every component of the primary key in the effective `order`, or use `list()`, which appends every missing primary-key component with ascending
> direction.

## Cursor encoding

```ts {"mode":"compile","id":"example-003"}
import { encodeCursor, decodeCursor } from '@zmdb/schema/dto';

const order = [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id', dir: 'asc' },
] as const;
const cursor = encodeCursor({ createdAt: new Date('2024-01-15T10:00:00Z'), id: 123 }, order);
const values = decodeCursor(cursor, order); // validates shape, values and exact ordering
```

The single token format is UTF-8/base64url JSON containing the effective order and tagged scalar values. Node and browser branches produce the same bytes. Strings, finite numbers, booleans, bigint and
valid Date values round-trip without losing their types. Nullish values, malformed data and old value-only tokens are rejected.

> [!WARNING] A cursor is encoding, not authentication — anyone can decode, edit and replay one. Never let a cursor carry authorisation; keep the tenant and owner predicates in the `where` on every
> page. See [Authorization](./web-authorization.html).

## ListResult

```ts {"mode":"compile","id":"example-004"}
interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number; // only if you pass it in
  readonly hasMore: boolean; // from the limit + 1 fetch
  readonly cursor?: string; // boundary row for the requested direction
}
```

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies buildListResult, orderBy, rows; this excerpt does not repeat those declarations."}
const result = buildListResult(rows, { limit: 20, orderBy });
// rows.length === 21 → hasMore = true, items = rows[0..19], cursor = encodeCursor(last kept row's sort keys)
// rows.length <= 20  → hasMore = false, items = rows, cursor = undefined
```

`orderBy` must already contain explicit directions and every primary-key tie-breaker. `buildListResult` also applies `select` projection per item. For a `before` page, query with each direction
reversed and pass `reverse: true`: the helper trims before restoring caller-visible order and encodes its first visible row for the next backward page. Offset results omit `orderBy` and return no
cursor. Results are inert values.

## Total count

`total` is opt-in and `list()` **never sets it** — a total is a second `COUNT(*)` query you run yourself and pass in:

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies buildListResult, countUsers, rows, where; this excerpt does not repeat those declarations."}
const result = buildListResult(rows, { limit: 20, total: await countUsers(where) });
```

> [!TIP] Only ask for a total when the UI shows "page 3 of 24". On a large table the count is the expensive part of the request — see [Count rows](./guide-count-rows.html) for the estimate-instead
> options.

## Typed DTOs

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies Entity; this excerpt does not repeat those declarations."}
type OffsetPage = { mode: 'offset'; limit: number; offset?: number | undefined; after?: never; before?: never };
type CursorPage = { mode: 'cursor'; limit: number; offset?: never } & ({ after?: string | undefined; before?: never } | { before?: string | undefined; after?: never });
type PaginationDTO<T> = OffsetPage | CursorPage;
```

Use `page: { mode: 'cursor', limit: 20 }` for the first page. Pass `after` to fetch following rows or `before` to fetch the preceding adjacent page, in the caller's order; the two directions are
mutually exclusive. A cursor is an opaque string, with no raw-object alternative. `ListDTO<T>` checks cursor ordering through `CursorOrderByDTO<T>`, which excludes nullable, undefined, optional and
non-scalar columns. Offset sorting remains independent.

## Cross-links

- [Cursor Pagination](./guide-cursor-pagination.html) — the repository-level story
- [Read DTOs](./read-dtos.html) — the full DTO family
- [Repository](./repository.html) — CRUD with pagination
- [Query Compiler](./select.html) — builder details
