Small helpers around the compiler and the DTO types. All of them are ordinary functions over ordinary data, which is most of the point.

## The compiled query is inspectable

```ts
import { postgres } from '@zmdb/postgres';

const q = createQueryCompiler(postgres).selectFrom('users').where('id', '=', 1).compile();
q.text; // 'SELECT * FROM "users" WHERE "id" = $1'
q.parameters; // [1]
```

Every `CompiledQuery` has readonly `text` and `parameters`. The default compiler still returns exactly those two keys, so existing logs, snapshots and equality checks remain unchanged:

```ts
expect(q).toEqual({ text: 'SELECT * FROM "users" WHERE "id" = $1', parameters: [1] });
```

Observability can opt into a third, optional compile-time field:

```ts
const observed = createQueryCompiler(postgres, { telemetry: true }).selectFrom('users').compile();
observed.telemetry; // { system: 'postgresql', operation: 'SELECT', collection: 'users' }
```

The compiler attaches it rather than asking a driver to parse generated SQL.

## Compiling for every dialect at once

Useful in tests, and the fastest way to see what a dialect does differently:

```ts
const dialects = ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore'] as const;
for (const d of dialects) {
  console.log(d, createQueryCompiler(d).selectFrom('users').where('id', '=', 1).compile().text);
}
// postgres SELECT * FROM "users" WHERE "id" = $1
// mysql    SELECT * FROM `users` WHERE `id` = ?
// sqlite   SELECT * FROM "users" WHERE "id" = ?
// mssql    SELECT * FROM [users] WHERE [id] = @p1
// cockroach SELECT * FROM "users" WHERE "id" = $1
// singlestore SELECT * FROM `users` WHERE `id` = ?
```

A builder exposes `readonly dialect`, so a helper that takes a builder can branch on it without being told twice.

## Interpolating parameters for a log line

Never for execution — only for a human reading a log:

```ts
export function explain(q: CompiledQuery): string {
  let i = 0;
  return q.text.replace(/\$\d+|@p\d+|\?/g, () => JSON.stringify(q.parameters[i++]));
}
```

> [!WARNING] The output is not valid SQL to run. Executing an interpolated string is exactly the injection vector parameters exist to close. Keep this in your logging module, not your data layer.

## Counting queries

The single execute boundary makes instrumentation straightforward:

```ts
export function countingDriver(inner: Driver) {
  const queries: CompiledQuery[] = [];
  return {
    driver: {
      ...inner,
      execute: (q, options) => {
        queries.push(q);
        return inner.execute(q, options);
      },
    } satisfies Driver,
    queries,
  };
}
```

Assert on `queries.length` to pin an N+1 down in a test. See [Testing](./testing.html).

## Typed helpers over the DTOs

Because `WhereDTO<S>` is a plain type, generic utilities are easy and stay checked:

```ts
export function and<S extends CoreSchema<string>>(...parts: WhereDTO<S>[]): WhereDTO<S> {
  return Object.assign({}, ...parts);
}

export function pageOf(query: { page?: string; per?: string }) {
  const limit = Math.min(Number(query.per ?? 20), 100);
  const offset = (Math.max(Number(query.page ?? 1), 1) - 1) * limit;
  return { limit, offset };
}
```

`and` is a merge, so two parts constraining the same column means the later wins rather than both applying — a real limitation of [`WhereDTO` having no combinators](./filters.html), not a subtlety of
the helper.

## Narrowing a row to a projection

```ts
export function pick<T, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = row[k];
  return out;
}
```

Prefer `select` on the query so the columns never leave the database — this is for reshaping what you already have. See [Projections](./projections.html).

---

See also: [Query Compiler](./select.html) · [Raw SQL](./raw-sql.html) · [Testing](./testing.html)
