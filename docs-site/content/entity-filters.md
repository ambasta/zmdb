> **ToDo / feature gap.** There is no filter registry — nothing equivalent to
> MikroORM's `@Filter` or TypeORM's soft-delete-aware `withDeleted`. A
> `WhereDTO` you do not pass is not applied.

The two things people want this for are multi-tenancy and soft deletes, and both are worth doing explicitly today because a silently-applied filter is a silently-_missing_ filter when someone reaches for the compiler instead of the repository.

## Soft delete

```ts
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}

const postSchema = schemaOf<Post>();
```

The tags go **inside** the parentheses on a nullable column — `(Date | null) & Sql<'timestamp'>`
distributes, and `null & Sql<'timestamp'>` is `never`.

Put the filter in a repository subclass so there is one place it can be wrong:

```ts
class PostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;

  private live(where: WhereDTO<Post> = {}): WhereDTO<Post> {
    return { ...where, deletedAt: { isNull: true } };
  }

  override find(where: WhereDTO<Post> = {}) {
    return super.find(this.live(where));
  }

  override list(dto: ListDTO<Post> = {}) {
    return super.list({ ...dto, where: this.live(dto.where) });
  }

  findWithDeleted(where: WhereDTO<Post> = {}) {
    return super.find(where);
  }

  softDelete(id: number) {
    return super.update(id, { deletedAt: new Date() });
  }
}
```

Override every read you use — `find`, `findOne`, `findAll`, `list`, `aggregate`. Missing one is the failure mode, so a test that asserts a soft-deleted row is absent from each is worth the lines.

## Multi-tenancy

Same shape, with the tenant coming from the request rather than a constant. Take it as a constructor argument and build the repository per request rather than reading ambient state:

```ts
class TenantPostRepository extends BaseRepository<Post> {
  static readonly schema = postSchema;

  constructor(
    driver: Driver,
    private readonly tenantId: number,
  ) {
    super(driver);
  }

  override find(where: WhereDTO<Post> = {}) {
    return super.find({ ...where, tenantId: { eq: this.tenantId } });
  }
}
```

Because the tenant is a constructor parameter, there is no way to construct the repository without deciding it, and no async-context plumbing to get wrong. See [Request Context](./web-request-context.html) for wiring it into a request-scoped provider.

## Row-level security instead

If you are on Postgres, the database can enforce this and then no application-level omission can bypass it:

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posts USING (tenant_id = current_setting('app.tenant_id')::int);
```

Set the variable in your driver, per connection, per request. This is the only version that is safe against someone writing raw SQL, which makes it the right answer for tenancy specifically.

## What it would take

The frozen design does not use `WhereDTO` factories. Parameterised filters are named
repository values whose `where(params)` returns compiler predicates; soft delete alone is
declared by a `SoftDelete<'deletedAt'>` tag because `delete`, DTO derivation, and schema
checking all need that table-level fact. Active predicates are conjoined while SQL is
compiled, and one filter can be disabled explicitly by name for one call.

That contract is not implemented yet, so the explicit repository and row-level-security
workarounds above remain the supported choices today.

---

See also: [Filters & Operators](./filters.html) · [Repository](./repository.html) · [Request Context](./web-request-context.html)
