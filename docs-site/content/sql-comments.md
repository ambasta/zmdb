> **Supported.** SQL comments are opt-in. `withComments` is the dependency-free driver
> decorator; `tracedDriver` additionally supplies the query span's
> `traceparent` when that key is selected. Neither stores request data on
> `CompiledQuery`, and the disabled path keeps the original SQL byte-for-byte.

## Why anyone wants this

A comment in the SQL text survives into `pg_stat_statements`, the slow-query log, and most APM tools. That is the difference between "this `SELECT` on `orders` is slow" and "the `SELECT` on `orders` issued by the checkout handler is slow" — which is the whole question when the same table is read from thirty places. The convention is [sqlcommenter](https://google.github.io/sqlcommenter/): `/*key='value',key2='value2'*/` appended to the statement.

## Doing it in the driver

The driver sees every statement and is the right place to add request-scoped
text without changing a reusable compiled query:

```ts
import { withComments } from '@zmdb/query-compiler/comments';

const driver = withComments(baseDriver, () => ({
  route: routePattern,
  controller: 'UsersController',
  action: 'get',
  framework: 'zmdb:1.0.0-alpha.4',
}));
```

Four details in the shipped decorator matter, and the third is the reason this
has a frozen spec:

1. **It spreads the driver.** Returning a bare `{ execute }` drops `dialect`, which `Driver` declares and the repository reads to pick its SQL.
2. **It spreads the query.** Rebuilding `{ text, parameters }` drops optional compile-time `telemetry`, so tracing and metrics lose their operation and collection labels.
3. **`.replace(/'/g, "\\'")`.** `encodeURIComponent` alone is not enough — see the next section.
4. **`.sort()`.** Sorted keys mean the same request produces the same statement text, so it is one `pg_stat_statements` row rather than one per key ordering. Same reason the [metrics page](./web-observability.html) sorts label keys.

For trace correlation, let `tracedDriver` create the query span and select the
keys that may reach the statement:

```ts
const observability = {
  tracer,
  comments: { keys: ['traceparent', 'route', 'action'] as const },
};

const driver = tracedDriver(baseDriver, observability, ctx.span, () => ({
  route: '/users/:id',
  action: 'get',
}));
const users = defineRepository(UserSchema, driver, { dialect: 'postgres' });
```

The configuration is an allowlist: the callback may return more closed keys,
but only `keys` are emitted. When `traceparent` is selected, `tracedDriver`
uses the query span it just created (or the supplied parent span when there is
no tracer), so the callback cannot accidentally tag the wrong span.

`route` is `/users/:id`, not `ctx.path` (`/users/1`). `Ctx` deliberately does
not expose the matched route, so the handler must close over the route pattern
it registered. `method` is not one of the five keys; `action`, the handler
name, carries the low-cardinality value wanted here.

Because there is no ambient request context, the closure is how the tag gets in — which is more wiring than a global, and also the reason two concurrent requests cannot tag each other's queries.

## Worked join: PostgreSQL slow-query log to trace

With the configuration above, the statement reaching PostgreSQL has the query
span's W3C trace context appended at execution time:

```sql
SELECT "id", "email" FROM "users" WHERE "id" = $1 /*action='get',route='%2Fusers%2F%3Aid',traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'*/
```

Configure PostgreSQL's `log_min_duration_statement` at the threshold you use for
slow queries, point `POSTGRES_LOG` at that server log, then extract the latest
tagged statement and split the standard
`version-trace-id-span-id-flags` value:

```sh
slow_line=$(rg "duration: .*traceparent='" "$POSTGRES_LOG" | tail -n 1)
traceparent=$(printf '%s\n' "$slow_line" | rg -o "traceparent='[^']+'" | cut -d"'" -f2)
test -n "$traceparent"

IFS=- read -r version trace_id span_id flags <<EOF
$traceparent
EOF
printf 'trace_id=%s\nspan_id=%s\n' "$trace_id" "$span_id"
```

Search the tracing backend by `trace_id`; inside that trace, `span_id` selects
the exact database span. For example, a Jaeger UI trace URL is:

```sh
printf '%s/trace/%s\n' "${JAEGER_UI_URL%/}" "$trace_id"
```

That is the join: the database log supplies the trace and query-span identities,
while the trace supplies the request, route, handler and surrounding operations.
The commands above were exercised against PostgreSQL 18.6; its logged statement
retained the complete trailing comment and yielded the two identifiers shown in
the SQL example.

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
- **`ZMDB_PREPARED=1` does not remove that trade-off.** It enables the benchmark driver's server-side prepared statements, whose cache key still includes the SQL text. A per-query `traceparent` deliberately makes that text unique and gives up the prepared-statement gain while diagnosis is enabled.
- **MySQL strips some comment forms** depending on the client and `CLIENT_MULTI_STATEMENTS`; verify the tag actually lands in your slow log before relying on it.
- **A trailing comment can confuse tooling** that appends its own `LIMIT` — real, and narrow: that tooling is a proxy rewriting statements, which has to parse SQL properly anyway. Trailing is nonetheless the frozen placement, for three reasons in increasing order of how annoying they are to find. Some proxies and MySQL clients strip a _leading_ comment, so the tag silently does not arrive. `text.startsWith('SELECT')` stays true, which snapshot assertions and `EXPLAIN` prefixing rely on. And a leading comment breaks the first-word verb extraction that [metrics](./web-observability.html) and most slow-query parsers use — so enabling tracing would degrade metrics, which is a self-inflicted bug worth avoiding by construction.

## The one key that is a real trade

Four of the five keys are low cardinality: `route`, `controller`, `action` and `framework` take one value per route per deploy, so the number of distinct statement texts is bounded by the route table.

`traceparent` is not, and it is the whole point of the feature. It contains a fresh span id per query, so **every statement becomes unique** — and it is also what turns "this `SELECT` on `orders` is slow" into a link to the trace of the request that issued it. There is no way to have both, so the frozen design names the trade rather than picking: `keys` is an explicit list, and putting `traceparent` in it is a decision to spend the plan cache on the correlation. Worth it while you are diagnosing; not a steady-state default. sqlcommenter's own documentation reaches the same conclusion.

## Rendered, not stored

**The comment does not go on `CompiledQuery` at all** — there is no
`comment?: string` field and no `.comment(s)` builder method. The decorator
renders it at execute time from the explicit request-scoped callback and, for
`tracedDriver`, the current query span.

That answers "does the comment count as part of the query's identity for `toEqual`" by removing the question: a compiled query has no comment, so its identity is exactly what it is today, and the same compiled query can be reused across two requests that tag it differently. A `.comment(s)` builder method would have made a per-request value part of a per-route cached object, which is the kind of thing that works until the cache is switched on.

`CompiledQuery` may carry optional `telemetry` — the dialect, operation and
table the compiler already knows — so tracing and metrics do not parse SQL.
The decorator preserves that field and the original parameter array while
changing only the copied query's `text`. With comments absent, `tracedDriver`
returns the original driver on the unobserved path and emits the original SQL.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Observability](./web-observability.html)
