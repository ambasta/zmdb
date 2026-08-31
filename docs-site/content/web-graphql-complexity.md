> **ToDo / feature gap.** There is no GraphQL layer, so there is no complexity
> analysis — no `@cost` directive, no depth limiter, no query cost estimation.

## The underlying risk, which applies to any API

A client that controls the shape of a query controls how much work your database does. GraphQL makes this vivid — a nested query can multiply out into millions of rows from a few hundred characters — but the same exposure exists in a REST API with an unbounded `limit` or a client-supplied `where`.

```graphql
query {
  posts {
    comments {
      author {
        posts {
          comments {
            author {
              name
            }
          }
        }
      }
    }
  }
}
```

Each level multiplies. With no depth limit and no batching, that is a self-inflicted denial of service, and it needs no authentication to attempt.

## The controls that exist here

**Cap every list.** The single most effective one:

```ts
const MAX_LIMIT = 100;

function page(input: { limit?: number; offset?: number }) {
  return { limit: Math.min(Math.max(input.limit ?? 20, 1), MAX_LIMIT), offset: input.offset ?? 0 };
}
```

Clamp rather than reject — a client asking for 10,000 gets 100 rather than an error, which is friendlier and equally safe. `Math.max(…, 1)` matters too: a negative limit is a dialect-dependent surprise.

**Never accept a `where` clause from a client verbatim.** `ListDTO.where` is typed, which prevents SQL injection, but it does not prevent an expensive predicate or an unauthorised filter. Map from a small allow-list of client-facing filters to `FieldOps`:

```ts
const FILTERS = { published: 'published', authorId: 'authorId' } as const;

function whereFrom(query: Readonly<Record<string, string>>) {
  const where: Record<string, unknown> = {};
  for (const [param, column] of Object.entries(FILTERS)) {
    const value = query[param];
    if (value !== undefined) where[column] = { eq: coerce(column, value) };
  }
  return where;
}
```

See [Conditional Filters](./guide-conditional-filters.html).

**Restrict which columns can be ordered by.** An `orderBy` on an unindexed column is a full sort of the table:

```ts
const SORTABLE = new Set(['id', 'createdAt', 'title']);
if (!SORTABLE.has(column)) throw new ValidationError('cannot sort by that column', []);
```

**Use keyset pagination.** `offset` grows more expensive as it increases — page 10,000 scans everything before it. See [Cursor Pagination](./guide-cursor-pagination.html).

**Batch relation loading.** An N+1 pattern is what turns a modest request into hundreds of queries; `findAllWithMany` and [DataLoaders](./dataloaders.html) collapse them.

## A query budget

The closest available analogue to complexity scoring, and it measures the thing that actually matters — queries issued, rather than an estimate of cost:

```ts
function budgeted(inner: Driver, max: number): Driver {
  let used = 0;
  return {
    async execute(query) {
      used += 1;
      if (used > max) throw new Error(`query budget of ${max} exceeded`);
      return inner.execute(query);
    },
  };
}
```

Build it [per request](./web-request-context.html), so the counter is per request rather than global:

```ts
const repo = defineRepository(posts, budgeted(base, 50), { dialect: 'postgres' });
```

A request that trips the budget is almost always an N+1 pattern you did not know about. Setting the limit generously and alerting on it is a better bug-finder than a synthetic complexity score — and unlike a score, it cannot be wrong about the cost.

## Statement timeouts

The backstop, and the one control that holds when your estimates are wrong:

```sql
SET statement_timeout = '5s';
```

Set it per session in your driver, or per role in the database. Note that [zmdb has no query cancellation](./query-cancellation.html) — an abandoned client does not stop the query — so a server-side timeout is the only thing that reclaims the work.

Set it on the database role rather than in application code where you can. A role-level default cannot be forgotten by a new code path.

## Rate limiting

Complexity limits bound one request; rate limits bound a client. You need both, and the framework has neither — do it at the proxy, the CDN or an API gateway, which is also where it survives your process restarting. See [Rate Limiting](./web-rate-limiting.html).

## What it would take

For GraphQL specifically, cost analysis follows [the layer itself](./web-graphql-resolvers.html).

Framework-side, the useful pieces are more general: a documented per-request query budget wrapper, and a `maxLimit` option on `ListDTO` handling so the clamp is not re-implemented in every handler. Both small, both benefit REST equally, and both are the kind of default that prevents a class of incident rather than one bug.

---

See also: [Cursor Pagination](./guide-cursor-pagination.html) · [Rate Limiting](./web-rate-limiting.html) · [Query Performance](./perf-queries.html)
