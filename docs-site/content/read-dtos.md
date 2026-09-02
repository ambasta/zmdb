Read Data Transfer Objects provide typed query inputs and result shapes for fetching data. zmdb derives all read types from your schema — any change to the schema automatically updates the DTOs, eliminating drift between your API contracts and database queries.

## WhereDTO — Typed Filters

Filter rows with column-level operators. Types are inferred from your schema.

```ts
import { compileWhere, type WhereDTO } from '@zmdb/schema-core/dto';

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

```ts
import { applyOrderBy, type OrderByDTO } from '@zmdb/schema-core/dto';

const orderBy: OrderByDTO<User> = [
  { column: 'createdAt', dir: 'desc' },
  { column: 'id' }, // defaults to 'asc'
];
```

**SQL emitted:** `ORDER BY "createdAt" DESC, "id" ASC`

## PaginationDTO — Cursor and Offset

Both offset and cursor-based pagination are supported.

```ts
import { applyPagination, type PaginationDTO } from '@zmdb/schema-core/dto';

// Offset pagination
const offsetPage = { limit: 20, offset: 40 };

// Cursor pagination (efficient for deep pages)
const cursorPage: PaginationDTO<User> = {
  limit: 20,
  after: { createdAt: '2024-01-15T10:00:00Z', id: 123 },
};
```

## GetDTO — Single Row Fetch

Narrow results to specific columns with optional population.

```ts
const opts: GetOptions<User> = {
  select: ['id', 'email'] as const,
  populate: ['orders'],
};
// Type narrows to Pick<Entity, 'id' | 'email'>
```

## ListDTO + ListResult — Paginated Lists

Full-featured list queries with filtering, sorting, pagination.

```ts
import { buildListResult, type ListResult } from '@zmdb/schema-core/dto';

const listDto: ListDTO<User> = {
  where: { role: 'admin' },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { limit: 20, offset: 0 },
  select: ['id', 'email', 'createdAt'] as const,
};

const result = buildListResult(rows, { limit: 20 });
// result: { items, hasMore, total?, cursor? }
```

> [!IMPORTANT]
> `total` is only present when you explicitly request it. `hasMore` is computed from limit+1 fetch.

## SearchDTO — Full-Text Search

Full-text search with ranking scores.

```ts
import { buildSearchResult, type SearchResult } from '@zmdb/schema-core/dto';

const searchDto: SearchDTO<User> = {
  query: 'john smith',
  columns: ['email', 'name'],
  page: { limit: 10 },
  rank: true, // adds _score
};

const searchResult: SearchResult<User> = buildSearchResult(rows, { limit: 10 });
// items have optional _score when rank: true
```

## Projection Helper

Use `project()` to narrow row types at runtime.

```ts
import { project } from '@zmdb/schema-core/dto';

const row = { id: 1, email: 'a@b.com', role: 'admin' };
const narrow = project(row, ['email', 'role'] as const);
// narrow: Pick<Row, 'email' | 'role'>
```

## Cross-links

- [Projections](./projections.html) — column narrowing
- [Pagination](./pagination.html) — detailed pagination
- [Repository](./repository.html) — CRUD with DTOs
