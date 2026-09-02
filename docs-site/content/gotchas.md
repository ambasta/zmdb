Things that are working as designed but will surprise you at least once.

## A validator call the transformer did not reach throws

```ts
import { is } from '@zmdb/aot-validator/utilities';

is<User>(raw); // transformed: a straight-line check, no allocation
// untransformed: throws `runtime type witness required in test/fallback mode`
```

The transformer's job is to replace the call with emitted code. Where it did not run over a
file, there is no type argument left to read at runtime, so the call **throws** rather than
returning a cheerful `true`. `schemaOf<T>()` is louder still, naming the plugin that should
have run.

That is deliberate: failing open would mean a production boundary that checks nothing and
says nothing about it. It also means a refused call site is a build error by default rather
than something you discover in an incident.

> [!WARNING]
> This remains the most common setup mistake — it is just no longer a silent one. One test
> that asserts a known-bad value is rejected still earns its keep, because it fails on the
> misconfiguration rather than on the payload. See [AOT Setup](./aot-setup.html).

## `bigint` columns come back as strings from some drivers

`Sql<'bigint'>` maps to a 64-bit integer, which does not fit in a JS `number`. `node-postgres` returns it as a `string` by default rather than lose precision. That is the driver's choice, not zmdb's — decide it in your driver. See [bigint primary keys](./bigint-keys.html).

## `timestamp` has no timezone semantics of its own

`Sql<'timestamp'>` emits the dialect's plain timestamp type — `TIMESTAMP` on Postgres, not `TIMESTAMPTZ`. What comes back depends on the driver and the column's actual type in the database. If you care, use a [custom type](./custom-types.html) with explicit `toDb` / `fromDb` so the conversion is in your code and testable.

## A default value lives in the migration, not in the declaration

```ts
createdAt: Date & Sql<'timestamp'> & HasDefault;
```

`HasDefault` says _that_ the column has one, which is what `CreateDTO<T>` needs to know. It cannot say _what_ the default is, because no type holds a runtime value. The value goes in the migration:

```sql
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();
```

That is a SQL expression, evaluated by the database. Writing a JS `Date` there pins one instant as a literal default, which is almost never what you want. See [Timestamp defaults](./guide-timestamp-defaults.html).

## `Serial` columns are omitted from `CreateDTO`, including in tests

```ts
type Create = CreateDTO<User>;
// { email: string }  — no `id`, and no `createdAt` either if it is HasDefault
```

Supplying one anyway is refused at the repository rather than ignored: `the database generates "id", so a payload cannot supply it`. If you want to insert an explicit id (fixtures, data import), that is a raw insert through the compiler, not `repo.create`.

## `populate` is one extra query per relation, not a join

`repo.findAll({ populate: ['posts'] })` runs two statements. That is deliberate — it avoids the row multiplication a join produces for one-to-many — but it means two round trips. For a single statement use `findJoined` / `joinRelation`. See [Loading Strategies](./loading-strategies.html).

## `find` with an empty `where` returns everything

`find({})` compiles to an unfiltered `SELECT`. There is no implicit limit. Use `list()` if you want pagination as part of the contract.

## Read replicas are routed by SQL text

`withReplicas` decides "write" from the statement's leading keyword. A read wrapped in a CTE that writes (`WITH x AS (INSERT ...)`) will be routed to a replica and fail there. Send anything unusual to the primary explicitly.

## `Sensitive` affects the derived documents, not queries

A `Sensitive` column is still selected and still comes back from the driver. What the tag removes is the property from `ReadDTO<T>`, and the field from every generated JSON Schema and OpenAPI document — in _every_ variant, `create` included. `Entity<T>` and `CreateDTO<T>` keep it deliberately, because you have to be able to send a password. If you need it never to leave the database, do not select it — use a [projection](./projections.html).

## Property order matters for composite operations

Column iteration order is the order the properties appear on the interface, and DDL emission follows it. Reordering them produces a migration diff even though nothing semantically changed.

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
