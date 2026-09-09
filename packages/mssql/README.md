# @zmdb/mssql

The SQL Server vertical owns the immutable `mssql` dialect, its migration hooks and catalog introspector, and the `mssqlDriver` adapter. The shared query compiler comes from `@zmdb/sql`; repository
and driver contracts come from `@zmdb/orm`. `mssqlVertical` pairs this dialect with its driver factory.

## Install

```bash
yarn add @zmdb/mssql@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2 @zmdb/migrations@1.0.0-beta.2 mssql@^12.7.0
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
yarn add --dev typescript@7.0.2 @types/node@26.4.1 @types/mssql@12.3.0
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `@zmdb/core` adds its selected
database package and client rather than replacing the product facade.

`mssql` is an optional peer in package metadata; install it explicitly for this recipe. Importing the vertical does not import the SDK or open a connection. Pass an already-connected pool to
`mssqlDriver`.

## Configure

The snippets below are successive steps in one module.

```ts
import sql from 'mssql';
import { mssql, mssqlDriver } from '@zmdb/mssql';

const address = process.env.DATABASE_URL;
if (address === undefined) throw new Error('DATABASE_URL is required');
const client = await new sql.ConnectionPool(address).connect();
const driver = mssqlDriver(client);
```

The application owns the client and closes it with `await client.close()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(mssql);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `mssql.migrations.emitUp(operation)` to obtain this database's DDL and `mssql.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up` and `down`
from `@zmdb/migrations`; transactional behavior follows the capability table below. The [complete installed workflow](../../fixtures/consumer-database-publication/runtime.mjs) creates a fresh table,
applies and rolls back its migration, and closes the supplied client.

## Introspect

```ts
const snapshot = await mssql.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `mssqlIntrospector` is also exported directly. Introspection and generated DDL use this vertical's semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `mssql.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support    |
| ------------------------------------- | --------------------- |
| INSERT/upsert/UPDATE/DELETE returning | yes, via OUTPUT       |
| Transactional DDL                     | yes                   |
| Schemas                               | yes                   |
| Sequences                             | yes                   |
| Generated columns                     | yes                   |
| Partial indexes                       | yes, filtered indexes |
| Foreign keys                          | yes                   |
| Row-level security                    | no                    |
| Streaming                             | no                    |
| Server-side cancellation              | no                    |

## Refusals and ownership

Pagination requires `ORDER BY`; unordered `OFFSET`/`FETCH` fails before dispatch. Row-level-security declarations, streaming and server-side cancellation are not advertised. SQL Server-specific
identity, computed-column and filtered-index handling belongs to this vertical, rather than a generic SQL spelling.

SQL Server owns its T-SQL compiler overrides, migration hooks, introspector and structural node-mssql adapter. It is an independent vertical, with no PostgreSQL or MySQL parent.

## Testing evidence

The [database publication qualification](../../fixtures/consumer-database-publication) builds real npm archives and installs this selected package in an independent consumer. Its public workflow
covers strict declarations, package/client ownership, parameterized CRUD, transaction rollback, migration application/rollback and catalog introspection. The
[SQL Server consumer](../../fixtures/database-mssql) adds the database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [SQL Server guide](../../docs-site/content/dialect-mssql.md) for the detailed contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
