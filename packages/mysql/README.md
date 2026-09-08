# @zmdb/mysql

The MySQL vertical owns the immutable `mysql` dialect, its migration hooks and catalog introspector, and the `mysqlDriver` adapter. The shared query compiler comes from `@zmdb/sql`; repository and
driver contracts come from `@zmdb/orm`. `mysqlVertical` pairs this dialect with its driver factory.

## Install

```bash
npm add @zmdb/mysql@1.0.0-alpha.4 @zmdb/sql@1.0.0-alpha.4 @zmdb/migrations@1.0.0-alpha.4 mysql2@^3.24.3
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
npm add -D typescript@7.0.2 @types/node@26.4.1
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `zmdb` adds its selected
database package and client rather than replacing the product facade.

`mysql2` is an optional peer in package metadata; install it explicitly for this recipe. The vertical neither imports the SDK nor creates a pool. Applications choose pool options such as charset and
large-number representation.

## Configure

The snippets below are successive steps in one module.

```ts
import { createPool } from 'mysql2/promise';
import { mysql, mysqlDriver } from '@zmdb/mysql';

const address = process.env.DATABASE_URL;
if (address === undefined) throw new Error('DATABASE_URL is required');
const client = createPool(address);
const driver = mysqlDriver(client);
```

The application owns the client and closes it with `await client.end()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(mysql);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `mysql.migrations.emitUp(operation)` to obtain this database's DDL and `mysql.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up` and `down`
from `@zmdb/migrations`; transactional behavior follows the capability table below. The [complete installed workflow](../../fixtures/consumer-database-publication/runtime.mjs) creates a fresh table,
applies and rolls back its migration, and closes the supplied client.

## Introspect

```ts
const snapshot = await mysql.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `mysqlIntrospector` is also exported directly. Introspection and generated DDL use this vertical's semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `mysql.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support |
| ------------------------------------- | ------------------ |
| INSERT/upsert/UPDATE/DELETE returning | no                 |
| Transactional DDL                     | no                 |
| Schemas                               | yes                |
| Sequences                             | no                 |
| Generated columns                     | yes                |
| Partial indexes                       | no                 |
| Foreign keys                          | yes                |
| Row-level security                    | no                 |
| Streaming                             | no                 |
| Server-side cancellation              | no                 |

## Refusals and ownership

The compiler and migration hooks refuse `RETURNING`, standalone sequences, partial indexes and row-level security. DDL is not transactional. `execute` returns an empty row array for commands; use the
public `executeResult` method when affected-row or insert-ID metadata is needed. Streaming and server-side cancellation are not advertised.

MySQL owns the parent dialect and structural mysql2 adapter. `@zmdb/singlestore` depends on its public family factories and supplies a distinct dialect, migration hooks and introspector. The parent
does not depend on its child, and a MySQL connection is not a SingleStore qualification.

## Testing evidence

The [database publication qualification](../../fixtures/consumer-database-publication) builds real npm archives and installs this selected package in an independent consumer. Its public workflow
covers strict declarations, package/client ownership, parameterized CRUD, transaction rollback, migration application/rollback and catalog introspection. The
[MySQL consumer](../../fixtures/database-mysql) adds the database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [MySQL guide](../../docs-site/content/dialect-mysql.md) for the detailed contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
