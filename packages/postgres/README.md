# @zmdb/postgres

The PostgreSQL vertical owns the immutable `postgres` dialect, its migration hooks and catalog introspector, and the `postgresDriver` adapter. The shared query compiler comes from `@zmdb/sql`;
repository and driver contracts come from `@zmdb/orm`. `postgresVertical` pairs this dialect with its driver factory.

## Install

```bash
yarn add @zmdb/postgres@1.0.0-beta.1 @zmdb/sql@1.0.0-beta.1 @zmdb/migrations@1.0.0-beta.1 pg@^8.23.0
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
yarn add --dev typescript@7.0.2 @types/node@26.4.1 @types/pg@8.23.1
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `@zmdb/core` adds its selected
database package and client rather than replacing the product facade.

`pg` is an optional peer in package metadata because callers supply the structural client. Install it explicitly for this node-postgres recipe; importing the vertical itself does not import the SDK or
create a pool.

## Configure

The snippets below are successive steps in one module.

```ts
import { Pool } from 'pg';
import { postgres, postgresDriver } from '@zmdb/postgres';

const client = new Pool({ connectionString: process.env.DATABASE_URL });
const driver = postgresDriver(client);
```

The application owns the client and closes it with `await client.end()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(postgres);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `postgres.migrations.emitUp(operation)` to obtain this database's DDL and `postgres.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up` and
`down` from `@zmdb/migrations`; transactional behavior follows the capability table below. The [complete installed workflow](../../fixtures/consumer-database-publication/runtime.mjs) creates a fresh
table, applies and rolls back its migration, and closes the supplied client.

## Introspect

```ts
const snapshot = await postgres.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `postgresIntrospector` is also exported directly. Introspection and generated DDL use this vertical's semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `postgres.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support |
| ------------------------------------- | ------------------ |
| INSERT/upsert/UPDATE/DELETE returning | yes                |
| Transactional DDL                     | yes                |
| Schemas                               | yes                |
| Sequences                             | yes                |
| Generated columns                     | yes                |
| Partial indexes                       | yes                |
| Foreign keys                          | yes                |
| Row-level security                    | yes                |
| Streaming                             | yes                |
| Server-side cancellation              | yes                |

## Refusals and ownership

Cursor streaming requires a queryable that can check out a client. Server-side cancellation additionally requires an independent queryable through `PgOptions.cancelVia`; the basic pool example does
not enable it. Retrying a transaction is explicit and reruns its callback, so keep non-idempotent external effects outside that callback.

PostgreSQL owns the parent dialect. Its public `postgresFamilyDriver`, `postgresFamilyIntrospector` and `postgresFamilyMigrations` let `@zmdb/cockroach` supply its own dialect and overrides. The
dependency points from CockroachDB to PostgreSQL; the parent does not install or inspect its child.

`postgresOutboxMigration(version)` provides the PostgreSQL outbox table, defaults and partial pending index as an ordinary migration.

## Testing evidence

The [database publication qualification](../../fixtures/consumer-database-publication) builds real npm archives and installs this selected package in an independent consumer. Its public workflow
covers strict declarations, package/client ownership, parameterized CRUD, transaction rollback, migration application/rollback and catalog introspection. The
[PostgreSQL consumer](../../fixtures/database-postgres) adds the database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [PostgreSQL guide](../../docs-site/content/dialect-postgres.md) for the detailed contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
