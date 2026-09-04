> **Not planned.** `@zmdb/web` does not include GraphQL complexity analysis
> because [GraphQL itself is out of scope](./web-graphql.html). This page remains
> useful for the broader problem of bounding client-controlled queries.

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

Put page sizes on it — `posts(limit: 50)` and `comments(limit: 50)` — and the frozen cost model scores that document at **12,630,051**, from 250 characters. On the default page size of 20 with no arguments at all it is still 328,821. The arithmetic is in `packages/web/src/graphql/complexity/SPEC.md` §5; the point of quoting it here is that the number does not need to be accurate to be decisive.

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

## What it would have taken

The design is frozen, in `packages/web/src/graphql/complexity/SPEC.md`, and will not be implemented — but it is the shape to copy if you write the estimator yourself. One function, called by your own transport controller, between `parse` and `execute`:

```ts
const document = parse(query);
const { cost, overLimit } = complexityOf(document, { costs, maxCost: 1000, variables, operationName });
if (overLimit)
  return json({ data: null, errors: [{ message: 'query is too complex', extensions: { code: 'QUERY_TOO_COMPLEX' } }] });
return json(await execute({ schema, document, variableValues: variables, operationName }));
```

> [!WARNING]
> There is no ambient enforcement, and there will not be. `@zmdb/web` does not serve `/graphql` and will not — [a GraphQL server next to a zmdb application is composition, not a framework feature](./web-graphql-resolvers.html) — so **an application whose own transport does not make this call has no limit.** That is stated rather than smoothed over, because it is the one way to end up unprotected while believing otherwise.

Four decisions in that design are worth keeping on record, because each is a place the obvious implementation is wrong.

**The estimate is an upper bound, not an average.** Aliases count separately, a fragment costs once per spread site, and sibling inline fragments are **summed** rather than maxed — taking the maximum looks more accurate, but a list of an interface contains values matching different arms, so all of them really do execute. An estimator that can undercount is a limit that can be walked around, and every one of those three is a published bypass.

**The list-ness of a field is not hand-written.** `costsOf<T>('Post')` derives which fields are lists and what each returns from the same type the SDL comes from, and your table supplies only the costs. A list field recorded as a scalar never multiplies — the limit silently stops bounding anything, and nothing fails.

**The refusal does not say how close you were.** The default message is `query is too complex` with no cost and no limit, because a client that learns both can binary-search your cost model. `revealLimit: true` gives you the numbers in development.

**It is not a validation rule.** That is the idiomatic position and it needs `ValidationContext`, a `graphql` class — and the GraphQL design deliberately has no `graphql` dependency. Between `parse` and `execute` needs nothing but the document.

Framework-side, two more general pieces are still worth having and are not part of that freeze: the per-request query budget above as a documented wrapper, and a `maxLimit` option on `ListDTO` handling so the clamp is not re-implemented in every handler. Both benefit REST equally. And note that the budget above is not made redundant by cost analysis — it measures queries actually issued rather than an estimate, so it catches the N+1 a cost model prices at 1.

---

See also: [Cursor Pagination](./guide-cursor-pagination.html) · [Rate Limiting](./web-rate-limiting.html) · [Query Performance](./perf-queries.html)
