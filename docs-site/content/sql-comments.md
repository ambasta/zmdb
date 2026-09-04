> **ToDo / feature gap.** There is no way to attach a comment to a compiled
> query. `CompiledQuery` always carries `text` and `parameters` and may carry
> optional compile-time `telemetry`, but the compiler emits no comment and there
> is no sqlcommenter driver decorator yet.
>
> The format, the closed key set and the escaping rules are frozen in
> `packages/query-compiler/src/comments/SPEC.md`. The wrapper below is the right
> idea with an escaping bug and a dropped field, both fixed in place.

## Why anyone wants this

A comment in the SQL text survives into `pg_stat_statements`, the slow-query log, and most APM tools. That is the difference between "this `SELECT` on `orders` is slow" and "the `SELECT` on `orders` issued by the checkout handler is slow" — which is the whole question when the same table is read from thirty places. The convention is [sqlcommenter](https://google.github.io/sqlcommenter/): `/*key='value',key2='value2'*/` appended to the statement.

## Doing it in the driver

The driver sees every statement and is the only place that knows what request it is serving, so a wrapper covers the whole application:

```ts
const encode = (s: string): string => encodeURIComponent(s).replace(/'/g, "\\'");

type CommentKey = 'traceparent' | 'controller' | 'action' | 'route' | 'framework';

function tagged(inner: Driver, tags: () => Partial<Record<CommentKey, string>>): Driver {
  return {
    ...inner,
    execute(q) {
      const t = Object.entries(tags())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${encode(k)}='${encode(v)}'`)
        .join(',');
      return inner.execute({ ...q, text: `${q.text} /*${t}*/` });
    },
  };
}
```

Four details in there that an earlier version of this page got wrong, and the third one is the reason this has a frozen spec:

1. **`...inner`.** Returning a bare `{ execute }` drops `dialect`, which `Driver` declares and the repository reads to pick its SQL. A decorator spreads what it wraps.
2. **`...q`.** Rebuilding `{ text, parameters }` drops optional compile-time `telemetry`, so tracing and metrics lose their operation and collection labels.
3. **`.replace(/'/g, "\\'")`.** `encodeURIComponent` alone is not enough — see the next section.
4. **`.sort()`.** Sorted keys mean the same request produces the same statement text, so it is one `pg_stat_statements` row rather than one per key ordering. Same reason the [metrics page](./web-observability.html) sorts label keys.

Construct it per request so the tags describe _this_ request:

```ts
const driver = tagged(base, () => ({ route: routePattern, action: 'list' }));
const repo = defineRepository(users, driver);
```

Two things about those values, both of which an earlier version of this page got wrong. `routePattern` is `/users/:id` and not `ctx.path`, which is `/users/1` — the first caveat below is about exactly that difference, and getting the pattern is harder than this line makes it look: `Ctx` carries `params`, `body`, `query`, `headers`, `method`, `path` and optional `span`, but not the matched route. The [metrics page](./web-observability.html) hits the same wall for `http.route` and for the same structural reason. And `method` is not one of the five frozen keys; `action` — the handler name — carries what you wanted it for, at one value per route rather than one per verb crossed with route.

Because there is no ambient request context, the closure is how the tag gets in — which is more wiring than a global, and also the reason two concurrent requests cannot tag each other's queries.

## Escaping, and why `encodeURIComponent` is not enough

> [!WARNING]
> This is the one part of observability where the failure mode is SQL injection in
> generated SQL. A value that closes the comment early turns the remainder of the
> tag into statement text, on a statement the application built and trusts.

Two facts, both easy to check in a REPL and neither of them obvious:

**`encodeURIComponent('*/')` is `'*%2F'`.** The `/` is what makes a comment terminator unrepresentable — `*` is unreserved and passes straight through. Worth knowing, because a "sanitizer" that strips `*` looks like it addressed the warning and has done nothing.

**`encodeURIComponent("o'brien")` is `"o'brien"`.** The apostrophe is unreserved and survives, so `${k}='${encodeURIComponent(v)}'` lets a value close its own quote and put the rest of the tag outside a quoted string. With `ctx.path` as the only value it is not exploitable — a path with `'` in it still cannot produce `*/` — but the escaping is one key away from being load-bearing, and this page was presenting it as the pattern to copy.

The rule, which is sqlcommenter's: **encode, then escape the surviving `'` as `\'`.** That order is what makes it unambiguous, because `encodeURIComponent('\\')` is `'%5C'` — every backslash in the input becomes `%5C`, so the only backslash left in a value is the escaper's own. No double-escaping question, and a reader can parse the tag back out.

```
{ route: "/users/:id", controller: "o'brien*/DROP", action: 'list' }
→  action='list',controller='o\'brien*%2FDROP',route='%2Fusers%2F%3Aid'
```

No `*/`, no unescaped `'`.

The frozen design goes one step further and takes the string away: the keys are a closed union — `traceparent`, `controller`, `action`, `route`, `framework` — rather than a `Record<string, string>`, so an arbitrary key cannot be written at a call site. An open key set is the interface through which a request id gets tagged and the plan cache dies, and through which an unescaped value arrives.

The guarantee is worth stating exactly, because it is narrower than "no path". An object literal carrying `request_id` is a compile error; a value whose declared type is already `Record<string, string>` is still assignable, because an index signature satisfies every optional member of the closed record and excess-property checking only applies to fresh literals. So the closed set removes the _accidental_ key, which is the one that actually arrives. For a value laundered through an open record the escaping is still what holds, which is why the serializer encodes the key as well as the value — a key it was told cannot need it.

## Caveats worth knowing before you turn it on

- **Prepared-statement caches key on the text.** A comment that varies per request makes every statement unique, which defeats server-side plan caching on Postgres and fills `pg_stat_statements` with one entry per variant. Tag with the _route_, not the request id.
- **MySQL strips some comment forms** depending on the client and `CLIENT_MULTI_STATEMENTS`; verify the tag actually lands in your slow log before relying on it.
- **A trailing comment can confuse tooling** that appends its own `LIMIT` — real, and narrow: that tooling is a proxy rewriting statements, which has to parse SQL properly anyway. Trailing is nonetheless the frozen placement, for three reasons in increasing order of how annoying they are to find. Some proxies and MySQL clients strip a _leading_ comment, so the tag silently does not arrive. `text.startsWith('SELECT')` stays true, which snapshot assertions and `EXPLAIN` prefixing rely on. And a leading comment breaks the first-word verb extraction that [metrics](./web-observability.html) and most slow-query parsers use — so enabling tracing would degrade metrics, which is a self-inflicted bug worth avoiding by construction.

## The one key that is a real trade

Four of the five keys are low cardinality: `route`, `controller`, `action` and `framework` take one value per route per deploy, so the number of distinct statement texts is bounded by the route table.

`traceparent` is not, and it is the whole point of the feature. It contains a fresh span id per query, so **every statement becomes unique** — and it is also what turns "this `SELECT` on `orders` is slow" into a link to the trace of the request that issued it. There is no way to have both, so the frozen design names the trade rather than picking: `keys` is an explicit list, and putting `traceparent` in it is a decision to spend the plan cache on the correlation. Worth it while you are diagnosing; not a steady-state default. sqlcommenter's own documentation reaches the same conclusion.

## What #583 still has to add

Less than this page previously assumed, and the difference resolves the open question it left. **The comment does not go on `CompiledQuery` at all** — no `comment?: string` field and no `.comment(s)` builder method. It is rendered at execute time by the driver decorator, from compile-time metadata on the query plus the request's context.

That answers "does the comment count as part of the query's identity for `toEqual`" by removing the question: a compiled query has no comment, so its identity is exactly what it is today, and the same compiled query can be reused across two requests that tag it differently. A `.comment(s)` builder method would have made a per-request value part of a per-route cached object, which is the kind of thing that works until the cache is switched on.

`CompiledQuery` now has optional `telemetry` — the dialect, operation and table
the compiler already knows — so nothing downstream has to parse SQL to label a
metric. It is populated only when an observing driver requests it, leaving
default snapshots byte-identical. #583 still owns the serializer, closed-key
lookup and execute-time decorator that appends the comment.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Observability](./web-observability.html)
