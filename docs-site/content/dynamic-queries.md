Filters that come from a request are conditional by nature. Both the DTO and the builder handle it; the DTO is usually the better fit because it is a plain object you can assemble.

## With `WhereDTO` — build the object

```ts
import type { WhereDTO } from '@zmdb/schema-core';

function buildWhere(q: { status?: string; minAge?: number; search?: string }): WhereDTO<User> {
  const where: WhereDTO<User> = {};
  if (q.status !== undefined) where.status = { eq: q.status };
  if (q.minAge !== undefined) where.age = { gte: q.minAge };
  if (q.search !== undefined) where.name = { like: `%${q.search}%` };
  return where;
}

await repo.list({ where: buildWhere(ctx.query), page: { limit: 20 } });
```

An empty object means no `WHERE` clause, so the "no filters" case needs no special handling. Every assignment is checked against the column type, so `{ minAge: 'x' }` does not compile.

> [!NOTE]
> Use `!== undefined`, not truthiness. `if (q.minAge)` drops `minAge=0`, and
> `if (q.status)` drops `status=''` — the classic pair of bugs in this exact
> function.

## Sorting and pagination from the request

```ts
const SORTABLE = ['name', 'createdAt', 'age'] as const;
type Sortable = (typeof SORTABLE)[number];

const isSortable = (v: string): v is Sortable => (SORTABLE as readonly string[]).includes(v);

const orderBy = isSortable(ctx.query.sort ?? '')
  ? [{ column: ctx.query.sort as Sortable, dir: ctx.query.dir === 'desc' ? 'desc' : 'asc' }]
  : [{ column: 'createdAt', dir: 'desc' }];
```

The allow-list matters: `orderBy.column` is typed as a column of the schema, but a string arriving from a query parameter is `string`, and the cast is where the check has to happen. Validating against a literal union means the cast is justified rather than assumed — and it stops a caller ordering by a [`Sensitive`](./tags-reference.html) column.

Better still, let the validator do it:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

const params = assert<{ sort?: Sortable; dir?: 'asc' | 'desc'; limit?: number }>(ctx.query);
```

## With the builder — conditional chaining

The builder is immutable, so each call returns a new one and you can reassign:

```ts
let q = createQueryCompiler('postgres').selectFrom('users');
if (status !== undefined) q = q.where('status', '=', status);
if (minAge !== undefined) q = q.andWhere('age', '>=', minAge);
const { text, parameters } = q.limit(20).compile();
```

Reach for this over the DTO when you need `orWhere`, `whereExists`, or an operator the DTO has no key for.

## Optional relations

```ts
const populate = ctx.query.include?.split(',').filter(isRelation) ?? [];
const rows = await repo.findAll({ populate });
```

Allow-list `isRelation` the same way — a caller that can name arbitrary relations can name expensive ones.

## Search across several columns

`WhereDTO` fields are combined with `AND`, so a single search term over three columns needs the builder:

```ts
const q = createQueryCompiler('postgres')
  .selectFrom('users')
  .where('name', 'ilike', `%${term}%`)
  .orWhere('email', 'ilike', `%${term}%`)
  .orWhere('bio', 'ilike', `%${term}%`)
  .compile();
```

For anything larger than a few columns, use [full-text search](./full-text-search.html) — three `ILIKE`s with a leading wildcard cannot use an index.

---

See also: [Conditional filters](./guide-conditional-filters.html) · [Filters & Operators](./filters.html) · [Select](./select.html)
