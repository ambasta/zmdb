# @zmdb/singlestore

The SingleStore vertical owns the immutable `singlestore` dialect, its migration hooks and catalog introspector, and the `singlestoreDriver` adapter. The shared query compiler comes from `@zmdb/sql`;
repository and driver contracts come from `@zmdb/orm`. `singlestoreVertical` pairs this dialect with its driver factory.

## Install

```bash
yarn add @zmdb/singlestore@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2 @zmdb/migrations@1.0.0-beta.2 mysql2@^3.24.3
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
yarn add --dev typescript@7.0.2 @types/node@26.4.1
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `@zmdb/core` adds its selected
database package and client rather than replacing the product facade.

`mysql2` is an optional peer in package metadata; install it explicitly for this recipe. The package depends on its MySQL-family parent and accepts an application-owned client.

## Configure

The snippets below are successive steps in one module.

```ts
import { createPool } from 'mysql2/promise';
import { singlestore, singlestoreDriver } from '@zmdb/singlestore';

const address = process.env.DATABASE_URL;
if (address === undefined) throw new Error('DATABASE_URL is required');
const client = createPool(address);
const driver = singlestoreDriver(client);
```

The application owns the client and closes it with `await client.end()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(singlestore);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `singlestore.migrations.emitUp(operation)` to obtain this database's DDL and `singlestore.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up`
and `down` from `@zmdb/migrations`; transactional behavior follows the capability table below. The [complete installed workflow](../../fixtures/consumer-database-publication/runtime.mjs) creates a
fresh table, applies and rolls back its migration, and closes the supplied client.

## Introspect

```ts
const snapshot = await singlestore.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `singlestoreIntrospector` is also exported directly. Introspection and generated DDL use this vertical's
semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `singlestore.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support |
| ------------------------------------- | ------------------ |
| INSERT/upsert/UPDATE/DELETE returning | no                 |
| Transactional DDL                     | no                 |
| Schemas                               | yes                |
| Sequences                             | no                 |
| Generated columns                     | yes                |
| Partial indexes                       | no                 |
| Foreign keys                          | no                 |
| Row-level security                    | no                 |
| Streaming                             | no                 |
| Server-side cancellation              | no                 |

## Refusals and ownership

Generated tables must declare a shard key or rowstore storage. Foreign keys, incompatible unique keys, check constraints, unsupported explicit index methods, sort keys on rowstore tables, storage
transitions and MySQL routine declarations are refused. `RETURNING`, transactional DDL, sequences, partial indexes, row-level security, streaming and server-side cancellation are not advertised.

SingleStore is a one-way child of `@zmdb/mysql`. It reuses public MySQL-family factories and owns SingleStore storage, migration, type and catalog overrides. The parent never depends on its child; the
shared mysql2 client does not make a MySQL server a SingleStore substitute.

`serial` emits `BIGINT AUTO_INCREMENT`, timestamps use `DATETIME(6)`, and full-text matching uses `MATCH(column) AGAINST(?)`. Shard keys, sort keys and rowstore storage are part of this vertical's
schema round trip.

## Testing evidence

The [database publication qualification](../../fixtures/consumer-database-publication) builds real npm archives and installs this selected package in an independent consumer. Its public workflow
covers strict declarations, package/client ownership, parameterized CRUD, transaction rollback, migration application/rollback and catalog introspection. The
[SingleStore consumer](../../fixtures/database-singlestore) adds the database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [SingleStore guide](../../docs-site/content/dialect-singlestore.md) for the detailed
contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
