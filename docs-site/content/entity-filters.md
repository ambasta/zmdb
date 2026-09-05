> **Runtime support is complete.** This page remains marked ToDo for the final
> documentation pass, not because the filter, write, or soft-delete APIs are absent.

A filter returns compiler predicates, never SQL text. It is declared on a repository
subclass or supplied through `RepositoryOptions`, and is active unless one call
disables it by name:

```ts
import { BaseRepository, type FilterDef } from '@zmdb/repository';

const livePosts = {
  name: 'live',
  where: (_params: void) => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;

class PostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;
  static readonly filters = [livePosts] as const;
}

await posts.findAll();
await posts.findAll({ filters: { live: false } });
```

The filter is compiled into SQL before pagination. The same structural compilation
point covers keyed reads, `find`, `findAll`, `list`, `count`, `exists`, full-text
reads, explicit joins, aggregations, loader batches, and populate queries. Raw
`driver.execute` calls remain outside this boundary because zmdb does not parse
caller-written SQL.

## Parameterised filters

Parameters are supplied per call. Missing, `null`, invalid, or unknown parameters
are refused before the query is compiled or sent to the driver:

```ts
const tenant = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

class TenantPostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;
  static readonly filters = [tenant] as const;
}

await posts.findAll({ filters: { tenant: { tenantId: request.tenantId } } });
```

See [Request Context](./web-request-context.html) for obtaining the value from a
request-scoped provider. For tenant isolation, database row-level security is still
the stronger boundary because it also constrains raw SQL.

## Write filters

`appliesToWrites` defaults to `true`, so the same tenant predicate constrains
`update`, `updateMany`, `increment`, `delete`, `deleteMany`, and `hardDelete`.
Parameters use the write method's options:

```ts
await posts.update(id, patch, { filters: { tenant: { tenantId: request.tenantId } } });
await posts.deleteMany({ status: 'expired' }, { filters: { tenant: { tenantId: request.tenantId } } });
```

A genuinely read-only filter opts out:

```ts
const searchVisibility = {
  name: 'searchVisibility',
  appliesToWrites: false,
  where: (_params: void) => [{ col: 'searchable', op: '=', value: true }] as const,
} as const satisfies FilterDef;
```

All repository updates and deletes pass through one write compiler boundary.
Missing parameters and unknown names are refused before SQL reaches the driver.

## Filters on joins and populate

A target-table filter names its table explicitly:

```ts
const visibleComments = {
  name: 'visibleComments',
  table: 'comments',
  schema: commentSchema,
  where: (_params: void) => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;
```

Repository populate uses its existing batched target query, so the target predicate
follows the key `IN (...)` in that query's `WHERE` for both cardinalities. The
lower-level `compilePopulate` helper and explicit/relation-aware joins keep a target
predicate in the join's `ON` clause; a filtered to-one `compilePopulate` statement
uses `LEFT JOIN`, so hiding a target never removes its parent.

## Audit the final statement

`RepositoryOptions.onQuery` observes the final compiled statement and the names of
the filters that were applied:

```ts
const posts = new PostRepository(driver, 'postgres', {
  onQuery(query, meta) {
    audit({ sql: query.text, filters: meta.filters });
  },
});
```

## Soft delete

Declare a nullable timestamp as managed at the table level:

```ts
import type { PrimaryKey, Serial, SoftDelete, Sql, Table } from 'zmdb/tags';

interface User extends Table<'users'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}
```

Reflection refuses a missing, non-nullable, or non-`timestamp` column. The managed
column remains visible on `Entity<User>` but is absent from `CreateDTO<User>` and
`UpdateDTO<User>`.

The declaration installs the built-in `softDelete` filter. Reads hide deleted rows,
and callers can opt into them explicitly:

```ts
await users.findById(id); // undefined after deletion
await users.findById(id, { filters: { softDelete: false } });
```

`delete(id)` writes a Node `Date` into the timestamp column and guards the update
with `deletedAt IS NULL`, so a second call returns `false` without moving the
original deletion time. PostgreSQL stores the abstract timestamp as `TIMESTAMPTZ`;
wire documents expose it as an ISO `date-time` string.

```ts
await users.delete(id); // UPDATE ... SET deletedAt = ? ... AND deletedAt IS NULL
await users.hardDelete(id); // deliberate physical DELETE of a visible row
await users.restore(id); // sets deletedAt back to NULL
```

`hardDelete` remains subject to write filters. To physically remove a row that is
already hidden, keep the destructive method name and widen only the visibility
filter: `hardDelete(id, { filters: { softDelete: false } })`. `restore` disables
only that built-in filter automatically and still applies other write filters.
Both soft and hard delete run `preDelete`; soft delete does not run `preUpdate`.

### Unique indexes and upsert

A normal unique index still contains deleted rows, so creating another user with
the same email fails. If replacement rows are the policy, use a partial unique
index whose predicate is `deletedAt IS NULL`.

An `upsert` collision takes the other explicit policy: it restores the existing row
by setting `deletedAt` to `NULL` while applying the conflict update. PostgreSQL's
partial-index conflict target syntax (`ON CONFLICT (email) WHERE deleted_at IS
NULL`) is not representable by the portable builder yet; use raw SQL for that
specific target.

## Row-level security instead

If you are on Postgres, the database can enforce this and then no application-level omission can bypass it:

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posts USING (tenant_id = current_setting('app.tenant_id')::int);
```

Set the variable in your driver, per connection, per request. This is the only version that is safe against someone writing raw SQL, which makes it the right answer for tenancy specifically.

---

See also: [Filters & Operators](./filters.html) · [Repository](./repository.html) · [Request Context](./web-request-context.html)
