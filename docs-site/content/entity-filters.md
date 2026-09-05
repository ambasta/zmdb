Entity filters are repository-level defaults. A filter returns compiler
predicates, and the repository combines them with the caller's predicates before
it compiles SQL. There is no JavaScript post-filtering.

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

const posts = new PostRepository(driver);
await posts.findAll();
await posts.findAll({ filters: { live: false } });
```

The first call emits:

```sql
SELECT * FROM "posts" WHERE "deletedAt" IS NULL
```

The per-call escape is deliberately named. There is no blanket
`{ filters: false }`, and an unknown filter name throws rather than silently
leaving a predicate enabled.

## Which reads are filtered

The root-table filter boundary covers `findById`, `findOne`, `find`, `findAll`,
`list`, `count`, `exists`, `stream`, full-text reads, aggregates, explicit joins,
loader batches, and the parent and target statements used by repository
populate.

Filters are compiled before ordering, pagination, and `LIMIT`. For example:

```sql
SELECT * FROM "users"
WHERE "deletedAt" IS NULL
ORDER BY "id" ASC
LIMIT 11 OFFSET 0
```

A keyset filter is copied into every `OR` branch, so a later branch cannot escape
the tenant or visibility predicate.

Raw `driver.execute` calls remain outside this boundary. zmdb does not parse SQL
the caller wrote, so an application-level filter is a default, not a database
security policy.

## A request-scoped tenant parameter

The tenant value belongs to the request, while the filter definition belongs to
the repository:

```ts
import type { Ctx } from '@zmdb/web';
import { BaseRepository, type Driver, type FilterDef } from '@zmdb/repository';

const tenant = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }],
} as const satisfies FilterDef<{ readonly tenantId: number }>;

class TenantPostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;
  static readonly filters = [tenant] as const;
}

interface RequestScope {
  readonly tenantId: number;
  readonly posts: TenantPostRepository;
  readonly filterOptions: {
    readonly filters: {
      readonly tenant: { readonly tenantId: number };
    };
  };
}

function scopeFor(ctx: Ctx, driver: Driver): RequestScope {
  const tenantId = tenantIdFrom(ctx.headers); // authenticate and validate here
  return {
    tenantId,
    posts: new TenantPostRepository(driver),
    filterOptions: { filters: { tenant: { tenantId } } },
  };
}

async function listPosts(ctx: Ctx, driver: Driver) {
  const scope = scopeFor(ctx, driver);
  return scope.posts.list({ where: { status: 'published' }, page: { limit: 20 } }, scope.filterOptions);
}
```

There is no ambient request context in `@zmdb/web`, so pass the scope or the
filter options through service calls. The same object can be passed to writes:

```ts
await scope.posts.update(id, patch, scope.filterOptions);
await scope.posts.deleteMany({ status: 'expired' }, scope.filterOptions);
```

The predicates are visible in the compiled SQL:

```sql
SELECT * FROM "posts"
WHERE "status" = $1 AND "tenantId" = $2
ORDER BY "id" ASC
LIMIT 21

UPDATE "posts"
SET "title" = $1
WHERE "id" = $2 AND "tenantId" = $3
RETURNING *
```

A missing or `null` parameter, an invalid parameter value, or an unknown filter
name is refused before the driver is called. Omitting `tenantId` produces an
error that names both the filter and the missing field:

```text
filter `tenant` requires parameters (tenantId) and none were supplied
```

### Loader boundary

Parameterless filters, including the built-in soft-delete filter, apply to
`LoaderScope` batches. A loader's `load()` method has no read-options argument,
so a parameterised filter cannot receive its request value through
`loaderFor()` or `relationLoader()` today. It fails before SQL with the same
missing-parameter error.

Use ordinary repository reads with explicit options, or put tenant enforcement
in a per-request driver or database row-level security when request batching and
tenant isolation must compose.

## Target filters on joins and populate

Filters are local to a repository instance; there is no process-global registry.
A filter for another table names that table and carries its schema so its columns
and parameters can be validated:

```ts
const visibleComments = {
  name: 'visibleComments',
  table: 'comments',
  schema: commentSchema,
  where: (_params: void) => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;

class PostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;
  static readonly filters = [tenant, visibleComments] as const;
}
```

This declaration on the parent repository is load-bearing. Repository populate
resolves a relation to a target table name, not to the target's complete schema.
Therefore a `SoftDelete<'deletedAt'>` declaration on `Comment` does not, by
itself, make `PostRepository` filter populated comments. Register the target
filter as above. Without it, the target statement is only:

```sql
SELECT * FROM "comments" WHERE "postId" IN ($1)
```

With it, repository populate runs the parent query and then one batched target
query per relation. This is true for both to-one and to-many relations:

```sql
SELECT * FROM "posts" WHERE "id" = $1 AND "tenantId" = $2 LIMIT 1

SELECT * FROM "comments"
WHERE "postId" IN ($1) AND "comments"."deletedAt" IS NULL
```

Filtering every target out leaves the already-selected parent in place. A
to-many relation attaches `[]`; a to-one relation attaches `null`.

The lower-level `compilePopulate` helper has a different to-one strategy. When
it is given target predicates, it uses a `LEFT JOIN` and keeps the target
predicate in `ON`:

```sql
SELECT * FROM "posts"
LEFT JOIN "users"
ON "posts"."userId" = "users"."id"
AND "users"."tenantId" = $1
```

`findJoined` and aggregate joins also place target predicates in `ON`, while
root-table filters remain in `WHERE`:

```sql
SELECT COUNT("posts"."id") AS "n"
FROM "users"
LEFT JOIN "posts"
ON "users"."id" = "posts"."userId"
AND "posts"."deletedAt" IS NULL
WHERE "active" = $1
```

Predicate placement does not override the requested join kind. `findJoined`
defaults to `LEFT JOIN`, but an explicit `kind: 'inner'`, an aggregate
`joinRelation` with its default kind, or a direct inner join can still remove a
parent whose target is filtered out.

Passing a target `TaggedSchema` to `findJoined` gives that call enough schema
information to derive the target's built-in soft-delete filter. A string target,
relation populate, and relation-aware aggregates need an explicit target
`FilterDef` on the repository.

## Audit the compiled statement

`RepositoryOptions.onQuery` observes each filtered read, update, or delete after
its predicates have been placed and before it reaches the driver:

```ts
const posts = new PostRepository(driver, 'postgres', {
  onQuery(query, meta) {
    audit({ sql: query.text, filters: meta.filters });
  },
});
```

`meta.filters` contains the names applied to that statement. Populate produces
separate observations for the parent and target statements, so the target
filter appears on the target query rather than being attributed to the parent.

This is a filter audit hook, not a universal driver hook. `create`, `upsert`, and
raw `driver.execute` calls do not pass through it.

## Write filters

`appliesToWrites` defaults to `true`. Applicable root filters therefore
constrain `update`, `updateMany`, `increment`, `delete`, `deleteMany`, and
`hardDelete`. `restore` retains every applicable filter except the built-in
`softDelete` predicate it must bypass.

```sql
UPDATE "users"
SET "role" = $1
WHERE "tenantId" = $2 AND "active" = $3
RETURNING "id"

DELETE FROM "users"
WHERE "tenantId" = $1 AND "active" = $2
RETURNING "id"
```

A genuinely read-only filter opts out:

```ts
const searchVisibility = {
  name: 'searchVisibility',
  appliesToWrites: false,
  where: (_params: void) => [{ col: 'searchable', op: '=', value: true }] as const,
} as const satisfies FilterDef;
```

### Create and upsert are outside the write-filter boundary

General filters constrain existing rows selected by an `UPDATE` or `DELETE`.
`create` and repository `upsert` do not accept filter options and do not append
tenant predicates:

```sql
INSERT INTO "users" ("tenantId", "email", "active")
VALUES ($1, $2, $3)
RETURNING *

INSERT INTO "users" ("tenantId", "email", "active")
VALUES ($1, $2, $3)
ON CONFLICT ("email") DO UPDATE
SET "tenantId" = EXCLUDED."tenantId", "active" = EXCLUDED."active"
RETURNING *
```

For tenant data, take `tenantId` from the trusted request scope rather than the
request body. Make tenant-scoped uniqueness and upsert targets composite, for
example `['tenantId', 'email']`; otherwise an unscoped conflict target can match
another tenant's row. The MySQL family ignores an explicit conflict target, so
do not use this portable upsert shape as the tenant boundary there.

## Soft delete

Declare one nullable timestamp as repository-managed:

```ts
import type { PrimaryKey, Serial, SoftDelete, Sql, Table } from 'zmdb/tags';

interface User extends Table<'users'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}
```

Reflection refuses a missing, non-nullable, or non-`timestamp` column. The
managed column remains on `Entity<User>` but is absent from `CreateDTO<User>` and
`UpdateDTO<User>`.

The declaration installs the built-in `softDelete` filter on that repository.
Reads hide deleted rows unless the caller names the escape:

```ts
await users.findById(id); // undefined after deletion
await users.findById(id, { filters: { softDelete: false } });
```

`delete(id)` writes a Node `Date` and uses the built-in filter as a guard:

```sql
UPDATE "users"
SET "deletedAt" = $1
WHERE "id" = $2 AND "deletedAt" IS NULL
RETURNING "id"
```

A second call matches nothing, returns `false`, and leaves the original deletion
time unchanged. `deleteMany(where)` uses the same guarded update.

`hardDelete(id)` is always a physical `DELETE`, but it remains filtered. It
removes a live row by default; removing an already-hidden row requires the
destructive method name and the explicit visibility escape:

```ts
await users.hardDelete(id, { filters: { softDelete: false } });
```

`restore(id)` sets the timestamp to `NULL`. It automatically excludes only the
built-in `softDelete` filter, because a hidden row is the only useful target,
while retaining tenant and other write filters:

```sql
UPDATE "users"
SET "deletedAt" = $1
WHERE "id" = $2 AND "tenantId" = $3
RETURNING "id"
```

Both soft and hard delete run `preDelete`; soft delete does not run `preUpdate`.
PostgreSQL and Cockroach store the timestamp as `TIMESTAMPTZ`; the JSON wire form
is an ISO `date-time` string.

### Unique indexes and upsert

A full unique index still contains a soft-deleted row, so creating a replacement
with the same email receives the database's ordinary unique-constraint error:

```sql
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")
```

On PostgreSQL, a partial unique index gives replacement rows the opposite policy:

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const ddl = createIndexDdl(
  {
    name: 'users_email_live',
    table: 'users',
    columns: ['email'],
    unique: true,
    where: '"deletedAt" IS NULL',
  },
  'postgres',
);
```

```sql
CREATE UNIQUE INDEX "users_email_live"
ON "users" ("email")
WHERE "deletedAt" IS NULL
```

`IndexDef.where` is raw SQL, so use the deployed physical column spelling. Use
this policy only on a dialect that provides partial or filtered indexes.

Repository `upsert` chooses restoration for a collision on a full unique key: it
sets `deletedAt` to `NULL` while applying the conflict update. PostgreSQL can
target a partial index with
`ON CONFLICT (email) WHERE "deletedAt" IS NULL`, but the portable builder cannot
represent that target predicate yet; use validated raw SQL for that statement.

## Boundaries at a glance

| Path                                    | Current filter behavior                              | Deliberate or current escape                                 |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Root reads, counts, streams, aggregates | Predicate is compiled into `WHERE` before pagination | Disable one named filter                                     |
| Repository populate                     | Target predicate is in the batched target `WHERE`    | Target filter must be declared on the parent repository      |
| Explicit and aggregate joins            | Target predicate is in `JOIN ... ON`                 | An explicitly inner join can still remove the parent         |
| `LoaderScope`                           | Parameterless filters are compiled into batch SQL    | Parameterised filters have no loader options and throw       |
| Existing-row updates and deletes        | `appliesToWrites` defaults on                        | Disable one name or set `appliesToWrites: false`             |
| `create` and general `upsert`           | No general filter is applied                         | Supply trusted tenant fields and tenant-scoped conflict keys |
| Raw `driver.execute`                    | No filter is applied                                 | Enforce the invariant in the database                        |

## Row-level security for a hard boundary

For PostgreSQL tenancy, row-level security also constrains raw SQL and code that
forgets repository options:

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON posts
USING (tenant_id = current_setting('app.tenant_id')::int);
```

Set the tenant on the database session per request and execute the protected
queries in the same transaction. See [Row-Level Security](./rls.html) and
[Request Context](./web-request-context.html) for the connection-lifetime rules.

---

See also: [Filters & Operators](./filters.html) · [Repository](./repository.html) ·
[Delete](./delete.html) · [Upsert](./upsert.html)
