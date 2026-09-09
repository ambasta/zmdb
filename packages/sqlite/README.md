# @zmdb/sqlite

The SQLite vertical owns the immutable `sqlite` dialect, its migration hooks and catalog introspector, and the `sqliteDriver` adapter. The shared query compiler comes from `@zmdb/sql`; repository and
driver contracts come from `@zmdb/orm`. `sqliteVertical` pairs this dialect with its driver factory.

## Install

```bash
yarn add @zmdb/sqlite@1.0.0-beta.2 @zmdb/sql@1.0.0-beta.2 @zmdb/migrations@1.0.0-beta.2
```

For the TypeScript snippets, install the declaration inputs used by the packed consumer:

```bash
yarn add --dev typescript@7.0.2 @types/node@26.4.1
```

Use Node.js 26+ and ESM. Keep the required `@zmdb/sql` and `@zmdb/orm` peers aligned with this package's version; npm resolves those peers. An application already using `@zmdb/core` adds its selected
database package and client rather than replacing the product facade.

The only runtime dependency is `@zmdb/migrations`; `@zmdb/sql` and `@zmdb/orm` are required same-version peers. No third-party database client is installed.

## Configure

The snippets below are successive steps in one module.

```ts
import { DatabaseSync } from 'node:sqlite';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

const client = new DatabaseSync(':memory:');
const driver = sqliteDriver(client);
```

The application owns the client and closes it with `client.close()` in a `finally` block after its work. Hosted services that accept this client's protocol are connection recipes, not additional
official database packages or automatically qualified server variants.

## Compile

```ts
import { createQueryCompiler } from '@zmdb/sql';

const compiler = createQueryCompiler(sqlite);
const query = compiler.selectFrom('users').where('id', '=', 7).compile();
```

Compilation is pure: the result carries SQL text and a separate parameter array. It does not create the `users` table or open a connection.

## Migrate

Use `sqlite.migrations.emitUp(operation)` to obtain this database's DDL and `sqlite.migrations.connection(driver)` to create its migration connection. Pass reviewed migration records to `up` and
`down` from `@zmdb/migrations`; transactional behavior follows the capability table below. Package-local migration and embedded integration tests cover application, rollback and connection cleanup.

## Introspect

```ts
const snapshot = await sqlite.introspector.snapshot(driver);
```

The snapshot comes from the selected database's real catalog through the same driver. `sqliteIntrospector` is also exported directly. Introspection and generated DDL use this vertical's semantics.

## Execute

```ts
const rows = await driver.execute(query);
```

Run this after migrating or otherwise creating the table. Use `driver.transaction(async transaction => ...)` for a pinned transactional driver; the application decides whether to retry. Query values
travel as parameters, not SQL string interpolation.

## Capabilities

These entries describe `sqlite.capabilities`; a true entry can still require the client support described below.

| Capability                            | Advertised support |
| ------------------------------------- | ------------------ |
| INSERT/upsert/UPDATE/DELETE returning | yes                |
| Transactional DDL                     | yes                |
| Schemas                               | no                 |
| Sequences                             | no                 |
| Generated columns                     | yes                |
| Partial indexes                       | yes                |
| Foreign keys                          | yes                |
| Row-level security                    | no                 |
| Streaming                             | yes                |
| Server-side cancellation              | no                 |

## Refusals and ownership

Schemas, standalone sequences and row-level security are unsupported. SQLite table changes that need a rebuild must use the migration planner; the adapter does not pretend an unsupported `ALTER TABLE`
is available. Streaming iterates the supplied statement; cancellation of an executing query is not advertised.

SQLite owns its dialect, migration hooks and introspector. The root, `/node` and `/embedded` entries import no Node built-in or database client; the application supplies the binding. `/embedded`
exposes the SQLite embedded migration runner.

## Testing evidence

Package-local driver, migration, introspection and embedded tests cover the SQLite behavior. The [SQLite consumer](../../fixtures/database-sqlite) adds database-specific capability and refusal checks.

Issue [#676](https://github.com/ambasta/zmdb/issues/676) records the completed installed workflows. Those observations are scoped to their recorded clients and servers; they do not certify every
compatible hosted service. Qualification reports identify their source, archive and server inputs. See the [SQLite guide](../../docs-site/content/dialect-sqlite.md) for the detailed contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
