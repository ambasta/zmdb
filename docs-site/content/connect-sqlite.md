Dialect: `sqlite` from `@zmdb/sqlite`. `node:sqlite` is a Node built-in, so no third-party database client is required — which makes it the fastest path to a working database and the best option for
tests.

## With `node:sqlite`

```ts
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '@zmdb/sqlite';

const db = new DatabaseSync(process.env.DB_PATH ?? 'app.db');

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

export const driver = sqliteDriver(db);
```

`sqliteDriver` enables `foreign_keys` on the supplied connection. The other two pragmas are application policy:

- **`foreign_keys = ON`** — off by default, **per connection**. Without it your foreign keys exist in the schema and are not enforced. This is the most common SQLite mistake.
- **`journal_mode = WAL`** — persists in the file once set; lets readers proceed while a write is in progress. Without it a read blocks behind every write.
- **`busy_timeout`** — wait for the write lock rather than failing immediately with `SQLITE_BUSY`.

## With `better-sqlite3`

```ts
import Database from 'better-sqlite3';

const db = new Database('app.db');
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export const driver: Driver = {
  async execute(query) {
    const stmt = db.prepare(query.text);
    return stmt.reader ? (stmt.all(...query.parameters) as Record<string, unknown>[]) : (stmt.run(...query.parameters), []);
  },
};
```

`stmt.reader` is nicer than the regex — it asks the statement whether it returns rows instead of guessing from the text.

## Type conversion

SQLite has five storage classes, so `boolean`, `timestamp` and `json` need handling. Add a hydration step, per column:

```ts
const hydrate = (r: Record<string, unknown>) => ({
  ...r,
  active: r.active === undefined ? undefined : Boolean(r.active),
  createdAt: typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt,
});
```

Per-column, not by value — a blanket `0 → false` rule turns a genuine count of zero into `false`. See [Dialect: SQLite](./dialect-sqlite.html).

## In tests

```ts
import { DatabaseSync } from 'node:sqlite';
import { snapshot, diff } from '@zmdb/query-compiler/migrations';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  sqliteDriver(db);
  const before = { version: 1, tables: [], extensions: [] };
  const after = snapshot(allSchemas);
  const operations = diff(before, after, { dialect: 'sqlite' });
  for (const operation of operations) db.exec(sqlite.migrations.emitUp(operation));
  return db;
}
```

Sub-millisecond, isolated per test, schema derived from your actual schema objects rather than a fixture. This is the single best reason to keep SQLite in a Postgres project. See
[Testing](./testing.html).

## Concurrency in production

SQLite serialises writes at the database level. WAL gives you concurrent readers, but two writers means one gets `SQLITE_BUSY`. That is fine for a single process and wrong for a multi-instance
deployment — and it is the real constraint on SQLite in production, not speed.

If you deploy on one instance with a persistent disk (Fly, Railway with a volume, a VPS), SQLite is a genuinely good choice. If you autoscale, use [Turso](./connect-turso.html) or Postgres.

## Backups

`VACUUM INTO` is atomic and safe on a live database:

```ts
await driver.execute({ text: `VACUUM INTO '/backups/app-${Date.now()}.db'`, parameters: [] });
```

Copying the `.db` file while a write is in progress produces a corrupt backup. Do not do that.

---

See also: [Dialect: SQLite](./dialect-sqlite.html) · [Testing](./testing.html) · [Turso](./connect-turso.html)
