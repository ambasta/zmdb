# @zmdb/jobs-sqlite

Explicit SQLite persistence for `@zmdb/jobs`. Install `@zmdb/jobs@alpha` and `@zmdb/jobs-sqlite@alpha` on Node.js 26 or later.

`createSqliteJobStore(database)` borrows a public `SqliteDatabase` connection. Apply the exported `jobsSqliteMigrations` before starting workers. `sqliteJobEnqueuer(database)` enqueues on the caller's
transaction without beginning or ending it.

`createMemoryJobStore()` owns a fresh `node:sqlite` memory database and applies both migrations. Its `close()` and `Symbol.dispose` close the database once. Borrowed stores leave the caller's database
open.

Pass stores to `jobsExtension({ workers, schedulers, stores })` to close them after background work stops. Both stores implement the portable queue and renewable scheduler-lease ports. The package has
one root export and a required `@zmdb/jobs@1.0.0-alpha.4` peer; it has no third-party runtime peer.
