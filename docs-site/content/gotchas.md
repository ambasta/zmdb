Things that are working as designed but will surprise you at least once.

## A generic validator call without the transformer silently accepts everything

```ts
import { is } from '@zmdb/aot-validator/utilities';

is<User>(raw); // with the transformer: a real check
// without it: no descriptor, nothing to check
```

The transformer's job is to supply the second argument. If your build does not run it, the call compiles and runs and tells you nothing. Verify with a deliberately wrong value in a test:

```ts
it('rejects a bad payload', () => {
  expect(is<User>({ email: 42 })).toBe(false); // fails loudly if untransformed
});
```

> [!WARNING]
> This is the single most common setup mistake. Every project should have one test like the above. See [AOT Setup](./aot-setup.html).

## `bigint` columns come back as strings from some drivers

`bigint()` maps to a 64-bit integer, which does not fit in a JS `number`. `node-postgres` returns it as a `string` by default rather than lose precision. That is the driver's choice, not zmdb's — decide it in your driver. See [bigint primary keys](./bigint-keys.html).

## `timestamp` has no timezone semantics of its own

`timestamp()` emits the dialect's plain timestamp type. What comes back depends on the driver and the column's actual type in the database. If you care, use a [custom type](./custom-types.html) with explicit `toDb` / `fromDb` so the conversion is in your code and testable.

## `defaultTo` is not evaluated by zmdb

```ts
createdAt: notNull(defaultTo(timestamp(), 'now()')),
```

The value is written into the DDL. It is a SQL expression, evaluated by the database. Passing a JS `Date` writes that instant as a literal default, which is almost never what you want.

## `serial` columns are omitted from `CreateDTO`, including in tests

```ts
type Create = CreateDTO<typeof users>;
// { email: string; createdAt: Date }  — no `id`
```

If you want to insert an explicit id (fixtures, data import), that is a raw insert through the compiler, not `repo.create`.

## `populate` is one extra query per relation, not a join

`repo.findAll({ populate: ['posts'] })` runs two statements. That is deliberate — it avoids the row multiplication a join produces for one-to-many — but it means two round trips. For a single statement use `findJoined` / `joinRelation`. See [Loading Strategies](./loading-strategies.html).

## `find` with an empty `where` returns everything

`find({})` compiles to an unfiltered `SELECT`. There is no implicit limit. Use `list()` if you want pagination as part of the contract.

## Read replicas are routed by SQL text

`withReplicas` decides "write" from the statement's leading keyword. A read wrapped in a CTE that writes (`WITH x AS (INSERT ...)`) will be routed to a replica and fail there. Send anything unusual to the primary explicitly.

## `sensitive()` affects serialization, not queries

A sensitive column is still selected and still comes back from the driver. It is excluded from the serialized output and from OpenAPI. If you need it never to leave the database, do not select it — use a [projection](./projections.html).

## Order matters in `defineSchema` for composite operations

Column iteration order is declaration order, and DDL emission follows it. Reordering columns in the schema object produces a migration diff even though nothing semantically changed.

## `UpdateBuilder.set()` cannot reference the current value

```ts
// This sets views to the literal 1, not views + 1.
updateTable('posts').set({ views: 1 });
```

There is no expression form yet. See [Incrementing and decrementing a value](./guide-increment-decrement.html) for the raw-SQL workaround and the tracked gap.

## `@zmdb/web` responses are strings

`WebResponse.body` is a `string`. Returning a `ReadableStream` from a handler will be stringified, not streamed. See [Streaming Files](./web-streaming-files.html).

## The DI container has no `@Injectable()`

Providers are declared in `@Module({ providers: [...] })` and resolved by token. A class that is not in a module's `providers` is not in the container, and you get `UnresolvedTokenError` at resolve time rather than a silent `undefined`.

## Modules compile eagerly

`createApp(RootModule)` walks the whole module graph and instantiates singletons. There is no lazy module loading, so a provider whose constructor does I/O will do it at boot. See [Lazy-Loading Modules](./web-lazy-modules.html).

---

See also: [FAQ](./faq.html) · [Goodies](./goodies.html) · [AOT Setup](./aot-setup.html)
