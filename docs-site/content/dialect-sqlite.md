SQLite is fully supported and is the dialect zmdb's own tests use most, because a schema-shaped database is one function call away and needs no server.

## Selecting it

```ts
const compiler = createQueryCompiler('sqlite');
const userRepo = defineRepository(users, sqliteDriver(db), { dialect: 'sqlite' });
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

## The three types that need conversion

SQLite has five storage classes, so three of the ten column types do not round-trip on their own. Handle it in the driver, which is the only place that knows the client:

```ts
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('app.db');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

export const driver: Driver = {
  async execute(q) {
    const stmt = db.prepare(q.text);
    const rows = q.text.trimStart().toUpperCase().startsWith('SELECT')
      ? stmt.all(...q.parameters)
      : (stmt.run(...q.parameters), []);
    return rows.map(hydrate);
  },
};

function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    active: row.active === undefined ? undefined : Boolean(row.active),
    createdAt: typeof row.createdAt === 'string' ? new Date(row.createdAt) : row.createdAt,
    address: typeof row.address === 'string' ? JSON.parse(row.address) : row.address,
  };
}
```

Per-column and explicit. A generic "coerce every 0/1 to boolean" rule will turn a real `count` of `1` into `true`.

For the same three going _in_, a [custom type](./custom-types.html) with `toDb` / `fromDb` puts the conversion next to the column declaration instead, which is usually the better home for it.

## The pragmas are not optional

```sql
PRAGMA foreign_keys = ON;   -- off by default, per connection
PRAGMA journal_mode = WAL;  -- concurrent readers with a writer
PRAGMA busy_timeout = 5000; -- wait for the write lock instead of failing
```

`foreign_keys` being off by default is the one that bites: the constraint exists
in your migration, and nothing enforces it. `sqliteDriver(db)` enables it when
the adapter wraps the connection. A custom driver must still set it on every
connection itself.

## Types are advisory

SQLite's declared column types are affinities, not constraints — a `TEXT` column will accept an integer. That means the database will not catch a type error the way Postgres would, so the type-level guarantees and the [validators](./validators-assert.html) are doing more of the work here. It is a reason to validate rows coming from a SQLite database you did not write.

## One writer

SQLite serialises writes at the database level. WAL mode lets readers proceed during a write, but two concurrent writers means one gets `SQLITE_BUSY`. That is fine for a single-process application and wrong for a multi-instance service — which is the real limit on using SQLite in production, not performance.

## Why it is the best test database

```ts
import { DatabaseSync } from 'node:sqlite';
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const op of diff({ tables: {} }, snapshot(allSchemas))) db.exec(emitUp(op, 'sqlite'));
  return db;
}
```

`node:sqlite` is a built-in, so this adds no dependency; `:memory:` gives per-test isolation in under a millisecond. See [Testing](./testing.html).

> [!WARNING]
> Testing on SQLite and deploying on Postgres means the differences above are
> untested. `ILIKE`, `RETURNING`, `ON CONFLICT`, JSON operators, transactional
> DDL and case sensitivity all differ. Run the fast suite on SQLite and a smaller
> integration suite against the real dialect.

## Connecting

[Local SQLite](./connect-sqlite.html), [Turso](./connect-turso.html), [SQLite Cloud](./connect-sqlite-cloud.html), [Cloudflare D1](./connect-cloudflare-d1.html), [Durable Objects](./connect-cloudflare-do.html), [Bun](./connect-bun.html), [React Native](./connect-react-native.html).

---

See also: [Connect: SQLite](./connect-sqlite.html) · [Testing](./testing.html) · [Custom Types](./custom-types.html)
