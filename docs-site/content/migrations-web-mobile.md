> [!NOTE] Bundle-resident SQLite migrations are supported through `zmdb embed` and the filesystem-free embedded runner. Choose the browser or mobile SQLite binding and map its three operations to
> `EmbeddedConnection`; no Node API or zmdb-owned platform package is required at runtime.

## What actually transfers

Most of zmdb does, because most of it is types and string manipulation:

- the declaration and `Entity` / `CreateDTO` / `WhereDTO` — types, no runtime
- `createQueryCompiler(...).compile()` — produces `{ text, parameters }`, no I/O
- `snapshot()`, `diff()`, `emitUp()` — pure functions over plain objects
- the AOT validators — generated code, no platform dependency

The platform-specific part is the last inch: something that takes `{ text, parameters }` and runs it.

## The embedded connection

The embedded runner deliberately does not import the query compiler or the server migration runner. Its three-method connection maps directly onto the SQLite bindings used in browsers and React
Native:

```ts
interface EmbeddedConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}
```

Over `expo-sqlite`:

```ts
import * as SQLite from 'expo-sqlite';
import type { EmbeddedConnection } from '@zmdb/query-compiler/migrations/embedded';

const db = await SQLite.openDatabaseAsync('app.db');

export const conn: EmbeddedConnection = {
  async exec(sql) {
    await db.execAsync(sql);
  },

  async run(sql, params) {
    await db.runAsync(sql, ...params);
  },

  async rows(sql, params) {
    return db.getAllAsync<Record<string, unknown>>(sql, ...params);
  },
};
```

The runner creates or upgrades `_zmdb_migrations(version, name, applied_at, checksum)`, compares build-time checksums, and issues `BEGIN` / `COMMIT` around each migration body and ledger insert. Do
not call it from inside another SQLite transaction.

Then, at startup:

```ts
import { runEmbedded } from '@zmdb/query-compiler/migrations/embedded';
import { migrations } from './generated/migrations.js';

await runEmbedded(conn, migrations);
```

For a browser binding such as `wa-sqlite` over OPFS, the shape is identical: map its multi-statement execute, parameterized write, and row-query calls onto the same three methods. The permanent
browser-shaped test exercises that asynchronous boundary without importing a Node API; only the binding-specific method names change.

## The constraints that make client-side migrations different

**Migrations run on a device you do not control.** A user can be four versions behind, so every migration has to apply cleanly from any older state, and you cannot fix a bad one by rolling back — the
device already ran it. Ship migrations you have tested from every supported starting version, not just from the previous one.

**There is no maintenance window.** The migration runs while the user is opening the app. A backfill over a large local table is a spinner on launch. Prefer nullable columns and lazy backfill over an
eager one.

**Storage can vanish.** OPFS can be evicted; the app can be reinstalled. The client database is a cache with a schema, not a system of record. Design for "empty at version 0" being a normal state.

**`down` is close to useless.** Rolling back an app version does not roll back the database, and a user who downgrades through TestFlight will run old code against a new schema. Make schema changes
additive so old code keeps working, and treat `down` as a development convenience.

## What happens on an app downgrade

If the ledger contains a version that is absent from the bundled array, `runEmbedded` throws an `EmbeddedMigrationError` with `kind: 'ledger-ahead'` before applying anything. The message names the
unknown ledger version and the newest migration in the bundle. That is an older app opening a database created by a newer one; continuing would let old code write through a schema it does not
understand.

Do not suppress that refusal. If the local database is a disposable, fully synchronized cache, the application may delete it and rebuild from version 0. If it contains unsynchronized user data, keep
the database and require the newer application instead.

## Generating migrations for the client

Generation happens on your machine, in Node, at build time — not on the device:

```bash
npx zmdb embed --out src/generated/migrations.ts
```

The command reads the configured migration directory in version order, copies each `-- zmdb:up` section verbatim, computes its SHA-256 checksum in Node, and writes a formatter-clean TypeScript array.
Without `--out`, it writes `embedded.ts` beside the SQL files. `--with-down` includes down sections for a development harness; the device runner does not use them.

Commit the generated module and run `npx zmdb check` in CI. It reports `stale-embedded` when the configured migration files and the module no longer match.

The device imports only the finished array and `@zmdb/query-compiler/migrations/embedded`. That leaf entry imports nothing, so the diff engine and DDL emitter do not enter the bundle. This is enforced
structurally, not left to tree-shaking: the permanent `does not pull the diff engine into the embedded runner's import graph` test resolves the public subpath and requires its graph to contain exactly
that one source file.

## Platform adapter boundary

The embedded runner needs only the three methods above. Application queries use the separate structural `Driver` boundary shown on [React Native](./connect-react-native.html) or
[Writing a Driver](./custom-driver.html). First-party wrappers around `expo-sqlite` or `wa-sqlite` would reduce adapter boilerplate, but they are not required for either migration execution or
repository queries.

---

See also: [React Native](./connect-react-native.html) · [Migration Runner](./migrations-cli.html) · [Writing a Driver](./custom-driver.html)
