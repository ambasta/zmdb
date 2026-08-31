> **ToDo / feature gap.** There is no way to attach a comment to a compiled
> query. `CompiledQuery` is `{ text, parameters }` and the compiler emits no
> leading comment, so there is no hook for a `/* app:checkout */` tag.

## Why anyone wants this

A comment in the SQL text survives into `pg_stat_statements`, the slow-query log, and most APM tools. That is the difference between "this `SELECT` on `orders` is slow" and "the `SELECT` on `orders` issued by the checkout handler is slow" — which is the whole question when the same table is read from thirty places. The convention is [sqlcommenter](https://google.github.io/sqlcommenter/): `/*key='value',key2='value2'*/` appended to the statement.

## Doing it in the driver

The driver sees every statement and is the only place that knows what request it is serving, so a wrapper covers the whole application:

```ts
function tagged(inner: Driver, tags: () => Record<string, string>): Driver {
  return {
    execute(q) {
      const t = Object.entries(tags())
        .map(([k, v]) => `${k}='${encodeURIComponent(v)}'`)
        .join(',');
      return inner.execute({ text: `${q.text} /*${t}*/`, parameters: q.parameters });
    },
  };
}
```

Construct it per request so the tags describe _this_ request:

```ts
const driver = tagged(base, () => ({ route: ctx.path, method: ctx.method }));
const repo = defineRepository(users, driver);
```

Because there is no ambient request context, the closure is how the tag gets in — which is more wiring than a global, and also the reason two concurrent requests cannot tag each other's queries.

> [!WARNING]
> `encodeURIComponent` is not decoration. A value containing `*/` terminates the
> comment and the rest becomes SQL. Never interpolate an unescaped
> request-derived string into statement text.

## Caveats worth knowing before you turn it on

- **Prepared-statement caches key on the text.** A comment that varies per request makes every statement unique, which defeats server-side plan caching on Postgres and fills `pg_stat_statements` with one entry per variant. Tag with the _route_, not the request id.
- **MySQL strips some comment forms** depending on the client and `CLIENT_MULTI_STATEMENTS`; verify the tag actually lands in your slow log before relying on it.
- **A trailing comment can confuse tooling** that appends its own `LIMIT`. Leading placement (`/*tag*/ SELECT ...`) is safer for pass-through proxies but is what some drivers strip.

## What it would take

Adding an optional `comment?: string` to `CompiledQuery` and a `.comment(s)` on each builder. It is a small change with one real question attached: whether the comment counts as part of the query's identity for equality and snapshot tests, since a great many existing tests compare `CompiledQuery` objects with `toEqual`. Making the field optional and omitted-by-default keeps those green, which is probably the answer.

---

See also: [Writing a Driver](./custom-driver.html) · [Query Performance](./perf-queries.html) · [Observability](./web-observability.html)
