`@zmdb/sqlite` is the official SQLite vertical. The default `zmdb` application includes it through `zmdb/sqlite`; independently installed consumers can select `@zmdb/sqlite` directly.

## Database-selection workflow

The six official database packages use the same selection workflow. The [package reference](./package-reference.html) owns current install and peer ranges; the
[SQLite package README](https://github.com/ambasta/zmdb/tree/main/packages/sqlite#install) includes the standalone TypeScript setup and full capability table.

| Step             | SQLite selection                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install          | `npm add @zmdb/sqlite@1.0.0-alpha.4`                                                                                                                                                                                                                |
| Configure        | Supply an application-owned `node:sqlite` client to `sqliteDriver(client)`; the application closes it.                                                                                                                                              |
| Compile          | `createQueryCompiler(sqlite)` from `@zmdb/sql` produces SQL and a separate parameter array.                                                                                                                                                         |
| Migrate          | `sqlite.migrations.emitUp(operation)` and `sqlite.migrations.connection(driver)` supply database-specific DDL and runner behavior; `@zmdb/migrations` owns `up`/`down`.                                                                             |
| Introspect       | `sqlite.introspector.snapshot(driver)` reads the real catalog.                                                                                                                                                                                      |
| Execute          | `driver.execute(query)` runs the compiled query; `driver.transaction(...)` pins transaction work.                                                                                                                                                   |
| Capabilities     | Read `sqlite.capabilities` and the package capability table; client-specific requirements still apply.                                                                                                                                              |
| Refusals         | schemas, standalone sequences and row-level security; see the detailed boundaries below.                                                                                                                                                            |
| Testing evidence | [The installed SQLite consumer](https://github.com/ambasta/zmdb/tree/main/fixtures/database-sqlite) and [the common six-database qualification](https://github.com/ambasta/zmdb/issues/676) prove their recorded package, client and server inputs. |

A hosted-service connection guide is a recipe using one of these owners or an explicitly supplied structural adapter. Protocol compatibility alone does not create another official package or transfer
the recorded server qualification to that service.

## Selecting it

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies createQueryCompiler, db, defineRepository, users; this excerpt does not repeat those declarations."}
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

const compiler = createQueryCompiler(sqlite);
const userRepo = defineRepository(users, sqliteDriver(db));
```

## What it emits

|                    | SQLite                                                    |
| ------------------ | --------------------------------------------------------- |
| Identifier quoting | `"users"."id"`                                            |
| Placeholders       | `?`                                                       |
| `serial`           | `INTEGER` (with `PRIMARY KEY`, it is the rowid alias)     |
| `bigint`           | `INTEGER` — already 64-bit                                |
| `boolean`          | `INTEGER`                                                 |
| `json`             | `TEXT`                                                    |
| `timestamp`        | `TEXT`                                                    |
| `numeric`          | `NUMERIC`                                                 |
| `ilike`            | falls back to `LIKE`, which is case-insensitive for ASCII |
| Materialized views | **not supported** — throws `UnsupportedFeatureError`      |
| `RETURNING`        | supported (3.35+)                                         |

## Column-specific value conversion

Use the official adapter for `node:sqlite` execution, transaction pinning and statement handling:

```ts {"mode":"compile","id":"example-002"}
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '@zmdb/sqlite';

const db = new DatabaseSync('app.db');
export const driver = sqliteDriver(db);
```

SQLite stores booleans as integers, JSON as text and timestamps using the declared storage representation. Put any application-specific conversion beside the column through a
[custom type](./custom-types.html) with `toDb` / `fromDb`; do not replace the official execution adapter with a SELECT-prefix parser. Conversion must be per column: changing every `0` or `1` to a
boolean also changes ordinary integer data. The application closes `db` after its work.

## Connection pragmas

```sql
PRAGMA foreign_keys = ON;   -- off by default, per connection
PRAGMA journal_mode = WAL;  -- concurrent readers with a writer
PRAGMA busy_timeout = 5000; -- wait for the write lock instead of failing
```

`foreign_keys` being off by default is the one that bites: the constraint exists in your migration, and nothing enforces it. `sqliteDriver(db)` enables it when the adapter wraps the connection. A
custom driver must still set it on every connection itself. WAL mode and the busy timeout remain application choices.

## Types are advisory

SQLite's declared column types are affinities, not constraints — a `TEXT` column will accept an integer. That means the database will not catch a type error the way Postgres would, so the type-level
guarantees and the [validators](./validators-assert.html) are doing more of the work here. It is a reason to validate rows coming from a SQLite database you did not write.

## One writer

SQLite serialises writes at the database level. WAL mode lets readers proceed during a write; contending writers must wait or handle `SQLITE_BUSY`. Choose the connection and deployment model around
that locking behavior.

## Why it is the best test database

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies allSchemas; this excerpt does not repeat those declarations."}
import { DatabaseSync } from 'node:sqlite';
import { diff, snapshot } from '@zmdb/migrations';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  sqliteDriver(db);
  const before = { version: 1, tables: [], extensions: [] };
  const after = snapshot(allSchemas);
  const operations = diff(before, after, { dialect: sqlite });
  for (const operation of operations) db.exec(sqlite.migrations.emitUp(operation));
  return db;
}
```

`node:sqlite` is a built-in, so this adds no client dependency; separate `:memory:` connections give isolated databases. See [Testing](./testing.html).

> [!WARNING] Testing on SQLite and deploying on Postgres means the differences above are untested. `ILIKE`, `RETURNING`, `ON CONFLICT`, JSON operators, transactional DDL and case sensitivity all
> differ. Run the fast suite on SQLite and a smaller integration suite against the real dialect.

## Connecting

[Local SQLite](./connect-sqlite.html), [Turso](./connect-turso.html), [SQLite Cloud](./connect-sqlite-cloud.html), [Cloudflare D1](./connect-cloudflare-d1.html),
[Durable Objects](./connect-cloudflare-do.html), [Bun](./connect-bun.html), [React Native](./connect-react-native.html).

---

See also: [Connect: SQLite](./connect-sqlite.html) · [Testing](./testing.html) · [Custom Types](./custom-types.html)
