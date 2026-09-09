# @zmdb/cockroach

The CockroachDB vertical owns the immutable `cockroach` dialect, its migration hooks and catalog introspector, and the `cockroachDriver` adapter. The shared query compiler comes from `@zmdb/sql`;
repository and driver contracts come from `@zmdb/orm`. `cockroachVertical` pairs this dialect with its driver factory.

## Install

```bash
yarn add @zmdb/cockroach@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2 @zmdb/migrations@1.0.0-beta.2 pg@^8.23.0
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
yarn add --dev typescript@7.0.2 @types/node@26.4.1 @types/pg@8.23.1
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `@zmdb/core` adds its selected
database package and client rather than replacing the product facade.

The package installs its PostgreSQL-family parent, not `pg`. Install `pg` explicitly for this recipe; no client or pool is loaded by importing the vertical.

## Configure

The snippets below are successive steps in one module.

```ts
import { Pool } from 'pg';
import { cockroach, cockroachDriver } from '@zmdb/cockroach';

const client = new Pool({ connectionString: process.env.DATABASE_URL });
const driver = cockroachDriver(client);
```

The application owns the client and closes it with `await client.end()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(cockroach);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `cockroach.migrations.emitUp(operation)` to obtain this database's DDL and `cockroach.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up` and
`down` from `@zmdb/migrations`; transactional behavior follows the capability table below. Package-local migration and live integration tests cover this workflow.

## Introspect

```ts
const snapshot = await cockroach.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `cockroachIntrospector` is also exported directly. Introspection and generated DDL use this vertical's semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `cockroach.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support |
| ------------------------------------- | ------------------ |
| INSERT/upsert/UPDATE/DELETE returning | yes                |
| Transactional DDL                     | no                 |
| Schemas                               | yes                |
| Sequences                             | yes                |
| Generated columns                     | yes                |
| Partial indexes                       | yes                |
| Foreign keys                          | yes                |
| Row-level security                    | no                 |
| Streaming                             | yes                |
| Server-side cancellation              | no                 |

## Refusals and ownership

PostgreSQL extensions, explicit index methods/operator classes, full-text operators and row-level-security declarations are refused. DDL is non-transactional. `cancelVia` is refused because
CockroachDB does not provide PostgreSQL `pg_cancel_backend()`. A retryable `40001` can rerun the complete transaction callback; keep non-idempotent external effects outside it.

CockroachDB is a one-way child of `@zmdb/postgres`. It reuses the public PostgreSQL-family factories, then owns CockroachDB migration, type and catalog overrides. The parent never depends on its
child; sharing the wire client does not make PostgreSQL acceptance evidence for CockroachDB.

`serial` emits `INT8 DEFAULT unique_rowid()` and `integer` emits `INT4`. The driver preserves node-postgres INT8 values as decimal strings; keep generated IDs opaque instead of coercing them with
`Number`.

## Testing evidence

Package-local dialect and live integration tests cover the CockroachDB behavior. The [CockroachDB consumer](../../fixtures/database-cockroach) adds database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [CockroachDB guide](../../docs-site/content/dialect-cockroach.md) for the detailed contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
