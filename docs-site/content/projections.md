Projections let you narrow the result set to specific columns, reducing payload size and improving query performance. zmdb provides compile-time type narrowing and a runtime helper for applying projections to fetched rows.

## Narrowing Select Results

The repository's read methods accept a `select` option that narrows the returned row type. This is type-safe — only valid column keys from the schema are allowed.

```ts
import type { Entity } from '@zmdb/schema-core';

// Given `interface User` with columns: id, email, role, createdAt
type UserRow = Entity<User>;
// UserRow = { id: number; email: string; role: string; createdAt: Date }

// Select only email and role — type narrows automatically
const minimal = await users.findById(1, { select: ['email', 'role'] as const });
// Type: { email: string; role: string } | undefined
```

## Runtime Projection Helper

The `project()` function applies a column selection to a fetched row, returning a new object with only the specified keys.

```ts
import { project } from '@zmdb/schema-core/dto';

const row = { id: 1, email: 'a@b.com', role: 'admin', createdAt: new Date() };

const narrow = project(row, ['email', 'role'] as const);
// narrow = { email: 'a@b.com', role: 'admin' }

// Passing undefined returns the row unchanged
const full = project(row, undefined);
// full = { id: 1, email: 'a@b.com', role: 'admin', createdAt: ... }
```

## SQL Emitted

When you specify `select` in a repository call, the compiler emits only those columns in the SELECT clause.

```ts
const q = qb.selectFrom('users').select(['email', 'role']).where('id', '=', 1).compile();

console.log(q.text);
// SELECT "email", "role" FROM "users" WHERE "id" = $1
```

> [!IMPORTANT]
> Projections are compile-time checked against the schema. If you reference a column that doesn't exist, TypeScript will error before your code runs.

## Use Cases

- API responses that expose only public-safe fields
- Dashboard queries fetching only display columns
- Reducing memory footprint for large result sets

```ts
// Expose only public-safe user data
const publicUser = await users.findById(id, {
  select: ['id', 'email', 'role'] as const,
});
// Never leaks internal fields like password_hash
```

> [!TIP]
> Combine projections with pagination to minimize data transfer. Fetch only what you display.

## Cross-links

- [Read DTOs](./read-dtos.html) — full GetDTO/ListDTO/SearchDTO documentation
- [Aliases](./aliases.html) — column renaming with AS
- [Repository](./repository.html) — CRUD with projection support
