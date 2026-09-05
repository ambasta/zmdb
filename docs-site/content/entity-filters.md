> **Partial support.** Named filters now cover repository reads. Write-path filters,
> the public `SoftDelete<'column'>` tag, `delete`-as-update, `hardDelete`, and
> `restore` remain feature gaps.

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

If a schema IR already carries `softDelete: { column: 'deletedAt' }`, repository
reads expose it as the built-in `softDelete` filter and callers can opt into deleted
rows with `{ filters: { softDelete: false } }`. The public schema tag and mutation
behaviour are not built yet, so applications must still implement soft deletion as
an explicit `update` until that write-side work lands.

## Row-level security instead

If you are on Postgres, the database can enforce this and then no application-level omission can bypass it:

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posts USING (tenant_id = current_setting('app.tenant_id')::int);
```

Set the variable in your driver, per connection, per request. This is the only version that is safe against someone writing raw SQL, which makes it the right answer for tenancy specifically.

---

See also: [Filters & Operators](./filters.html) · [Repository](./repository.html) · [Request Context](./web-request-context.html)
