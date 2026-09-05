A search endpoint takes optional filters and applies the ones that were supplied. There are two ways to do it, and one classic bug.

## With the DTO API

Build the `where` object conditionally:

```ts
import type { WhereDTO } from '@zmdb/repository';

interface Query {
  minAge?: number;
  name?: string;
  active?: boolean;
}

export async function search(q: Query) {
  const where: WhereDTO<User> = {};
  if (q.minAge !== undefined) where.age = { gte: q.minAge };
  if (q.name !== undefined) where.name = { ilike: `%${q.name}%` };
  if (q.active !== undefined) where.active = { eq: q.active };

  return userRepo.list({ where, orderBy: [{ column: 'id', dir: 'asc' }], page: { limit: 20 } });
}
```

An empty `where` is a valid unfiltered query, so no special case is needed for "no filters".

## The bug

```ts
if (q.minAge) where.age = { gte: q.minAge }; // wrong
```

`0` is falsy. So is `''`, and so is `false`. `minAge=0` silently drops the filter, and `active=false` searches for active users — the worst kind of bug, because it looks right and only fails on one
input.

Always compare against `undefined`. And turn on `strict-boolean-expressions` in your linter, which flags exactly this:

```jsonc
{ "rules": { "@typescript-eslint/strict-boolean-expressions": "error" } }
```

> [!WARNING] `exactOptionalPropertyTypes: true` makes `where.age = undefined` a type error rather than a silent no-op, which is what you want. Assign inside the `if`, never unconditionally.

The spread form has the same bug in a shape the linter rule above does not catch:

```ts
const where: WhereDTO<User> = { age: q.minAge === undefined ? {} : { gte: q.minAge } }; // wrong
```

Every key of the operator map is optional, so `{}` type-checks. It used to mean "no operator on `age`", which folded to no predicate at all — the column was named and every row matched. It is now a
`ValidationError` naming the column, so the mistake is a 400 rather than a full table scan on a `SELECT` and the whole table on an `UPDATE` or `DELETE`. Omit the key instead:

```ts
const where: WhereDTO<User> = { ...(q.minAge === undefined ? {} : { age: { gte: q.minAge } }) };
```

## With the builder

Reassign — the builder is immutable, so a bare call is discarded:

```ts
let b = createQueryCompiler('postgres').selectFrom('users');

if (q.minAge !== undefined) b = b.where('age', '>=', q.minAge);
if (q.name !== undefined) b = b.andWhere('name', 'ilike', `%${q.name}%`);
if (q.active !== undefined) b = b.andWhere('active', '=', q.active);

const { text, parameters } = b.orderBy('id', 'asc').limit(20).compile();
```

Note `where` for the first predicate and `andWhere` after. If the first filter is conditional, you cannot know which is which — so start from a predicate that is always true:

```ts
let b = createQueryCompiler('postgres').selectFrom('users').where('deleted_at', 'is null', null);
// every subsequent filter is andWhere
```

Or use the DTO API, which has no such ordering concern. That is usually the better answer.

## Parsing query strings first

Everything in `req.query` is a string. Coerce and validate before it reaches the filter builder:

```ts
interface RawQuery {
  minAge?: string;
  name?: string;
  active?: string;
}

const raw = assert<RawQuery>(ctx.query);
const q: Query = {
  ...(raw.minAge !== undefined ? { minAge: Number(raw.minAge) } : {}),
  ...(raw.name !== undefined ? { name: raw.name } : {}),
  ...(raw.active !== undefined ? { active: raw.active === 'true' } : {}),
};
if (q.minAge !== undefined && Number.isNaN(q.minAge)) throw new ValidationError('minAge must be a number', []);
```

`Number('abc')` is `NaN`, and `NaN` is a `number` — so it passes a type check and reaches your database as a nonsense parameter. Check for it explicitly.

## Whitelist the sort column

```ts
const SORTABLE = ['id', 'name', 'created_at'] as const;
type Sortable = (typeof SORTABLE)[number];

const column: Sortable = SORTABLE.includes(q.sort as Sortable) ? (q.sort as Sortable) : 'id';
```

`orderBy` in the DTO is typed to the schema's columns, so a value from a query string cannot be passed without narrowing it — which is the type system pushing you toward the whitelist rather than a
cast.

## What is not available

There is no `and`/`or` combinator at the DTO level, so a nested `(a AND b) OR (c AND d)` is not expressible in `WhereDTO`. Use the builder's `orWhere`, or [raw SQL](./raw-sql.html) for genuinely
complex predicates.

---

See also: [Dynamic Queries](./dynamic-queries.html) · [Repository API](./repository.html) · [Gotchas](./gotchas.html)
