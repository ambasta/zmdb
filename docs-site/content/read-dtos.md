Read Data Transfer Objects provide typed query inputs and result shapes for fetching data. zmdb derives all read types from your schema — any change to the schema automatically updates the DTOs,
eliminating drift between your API contracts and database queries.

## WhereDTO — Typed Filters

Filter rows with column-level operators. Types are inferred from your schema.

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { compileWhere } from '@zmdb/orm/dto';
import { type WhereDTO } from '@zmdb/schema/dto';

const where: WhereDTO<User> = {
  role: 'admin', // eq shorthand
  age: { gte: 18, lt: 65 }, // operators
  email: { like: '%@corp.com' },
  status: { in: ['active', 'pending'] },
  deletedAt: { isNull: true },
};
```

**SQL emitted:**

```sql
SELECT * FROM "users" WHERE
  "role" = $1 AND "age" >= $2 AND "age" < $3
  AND "email" LIKE $4 AND "status" IN ($5, $6)
  AND "deletedAt" IS NULL
```

## OrderByDTO — Typed Sorting

Specify columns and direction with compile-time type checking.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { applyOrderBy } from '@zmdb/orm/dto';
import { type OrderByDTO } from '@zmdb/schema/dto';

const orderBy: OrderByDTO<User> = [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id' }, // defaults to 'asc'
];
```

**SQL emitted:** `ORDER BY "createdAt" DESC, "id" ASC`

## PaginationDTO — Cursor and Offset

Both offset and cursor-based pagination are supported.

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies User; this excerpt does not repeat those declarations."}
import { applyPagination } from '@zmdb/orm/dto';
import { encodeCursor, type PaginationDTO } from '@zmdb/schema/dto';

// Offset pagination
const offsetPage: PaginationDTO<User> = { mode: 'offset', limit: 20, offset: 40 };

// Cursor pagination (efficient for deep pages)
const order = [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id', dir: 'asc' },
] as const;
const cursorPage: PaginationDTO<User> = {
  mode: 'cursor',
  limit: 20,
  after: encodeCursor({ createdAt: new Date('2024-01-15T10:00:00Z'), id: 123 }, order),
};
```

Omit both `after` and `before` for the first cursor page. Use `before` for the preceding adjacent page, returned in the caller's order. The two directions are mutually exclusive; tokens must match the
complete effective ordering, including every primary-key tie-breaker. `ListDTO<T>` restricts cursor sorting to defined, non-null scalar columns. Offset sorting keeps the wider `OrderByDTO<T>` surface.

## GetDTO — Single Row Fetch

Narrow results to specific columns with optional population.

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies GetOptions, User; this excerpt does not repeat those declarations."}
const opts: GetOptions<User> = {
  select: ['id', 'email'] as const,
  populate: ['orders'],
};
// Type narrows to Pick<Entity, 'id' | 'email'>
```

## ListDTO + ListResult — Paginated Lists

Full-featured list queries with filtering, sorting, pagination.

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies ListDTO, User, rows; this excerpt does not repeat those declarations."}
import { buildListResult, type ListResult } from '@zmdb/schema/dto';

const listDto: ListDTO<User> = {
  where: { role: 'admin' },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { mode: 'offset', limit: 20, offset: 0 },
  select: ['id', 'email', 'createdAt'] as const,
};

const result = buildListResult(rows, { limit: 20 });
// result: { items, hasMore, total?, cursor? }
```

> [!IMPORTANT] `total` is only present when you explicitly request it. `hasMore` is computed from limit+1 fetch.

## SearchDTO — Full-Text Search

Full-text search with ranking scores.

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies SearchDTO, User, rows; this excerpt does not repeat those declarations."}
import { buildSearchResult, type SearchResult } from '@zmdb/schema/dto';

const searchDto: SearchDTO<User> = {
  query: 'john smith',
  columns: ['email', 'name'],
  page: { mode: 'offset', limit: 10 },
  rank: true, // adds _score
};

const searchResult: SearchResult<User> = buildSearchResult(rows, { limit: 10 });
// items have optional _score when rank: true
```

## Projection Helper

Use `project()` to narrow row types at runtime.

```ts {"mode":"compile","id":"example-007"}
import { project } from '@zmdb/schema/dto';

const row = { id: 1, email: 'a@b.com', role: 'admin' };
const narrow = project(row, ['email', 'role'] as const);
// narrow: Pick<Row, 'email' | 'role'>
```

## Cross-links

- [Projections](./projections.html) — column narrowing
- [Pagination](./pagination.html) — detailed pagination
- [Repository](./repository.html) — CRUD with DTOs
