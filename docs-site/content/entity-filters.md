> **ToDo / feature gap.** There is no filter registry — nothing equivalent to
> MikroORM's `@Filter` or TypeORM's soft-delete-aware `withDeleted`. A
> `WhereDTO` you do not pass is not applied.

The two things people want this for are multi-tenancy and soft deletes, and both are worth doing explicitly today because a silently-applied filter is a silently-_missing_ filter when someone reaches for the compiler instead of the repository.

## Soft delete

```ts
export const posts = defineSchema('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  deletedAt: timestamp().nullable(),
});
```

Put the filter in a repository subclass so there is one place it can be wrong:

```ts
class PostRepository extends BaseRepository<typeof posts> {
  private live(where: WhereDTO<typeof posts> = {}): WhereDTO<typeof posts> {
    return { ...where, deletedAt: { isNull: true } };
  }

  override find(where: WhereDTO<typeof posts> = {}) {
    return super.find(this.live(where));
  }

  override list(dto: ListDTO<typeof posts> = {}) {
    return super.list({ ...dto, where: this.live(dto.where) });
  }

  findWithDeleted(where: WhereDTO<typeof posts> = {}) {
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
class TenantPostRepository extends BaseRepository<typeof posts> {
  constructor(
    driver: Driver,
    private readonly tenantId: number,
  ) {
    super(driver, posts);
  }

  override find(where: WhereDTO<typeof posts> = {}) {
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

A `filters` option on `defineRepository` holding named `WhereDTO<S>` factories plus a default-enabled flag, merged in `BaseRepository`'s single where-building path. The merge is the design question: two filters both constraining `deletedAt` need an `and` at the DTO level, and [`WhereDTO` has no `and`/`or` combinators](./filters.html) — so this gap sits behind that one.

---

See also: [Filters & Operators](./filters.html) · [Repository](./repository.html) · [Request Context](./web-request-context.html)
