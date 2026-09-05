> **ToDo / feature gap.** The migration runner needs a `MigrationConnection`, and
> the browser and React Native have no such connection out of the box. Nothing in
> zmdb ships an adapter for `wa-sqlite`, `sql.js`, OPFS, `expo-sqlite` or
> `op-sqlite`. `node:sqlite` is a Node built-in and is not available in either
> environment. See also [React Native](./connect-react-native.html).

## What actually transfers

Most of zmdb does, because most of it is types and string manipulation:

- the declaration and `Entity` / `CreateDTO` / `WhereDTO` — types, no runtime
- `createQueryCompiler(...).compile()` — produces `{ text, parameters }`, no I/O
- `snapshot()`, `diff()`, `emitUp()` — pure functions over plain objects
- the AOT validators — generated code, no platform dependency

What does not transfer is the last inch: something that takes `{ text, parameters }` and runs it.

## Implementing the connection

`MigrationConnection` has four required methods. The optional members below add
checksum verification and a transaction around each migration plus its ledger
row:

```ts
interface MigrationConnection {
  exec(sql: string): Promise<void> | void;
  appliedVersions(): Promise<readonly number[]> | readonly number[];
  appliedMigrations?():
    | Promise<readonly { version: number; name: string; checksum: string | null }[]>
    | readonly { version: number; name: string; checksum: string | null }[];
  recordApplied(version: number, name: string, checksum?: string): Promise<void> | void;
  recordReverted(version: number): Promise<void> | void;
  ensureVersionTable?(): Promise<void> | void;
  checksum?(sql: string): Promise<string> | string;
  transaction?<T>(run: (connection?: MigrationConnection) => Promise<T>): Promise<T>;
}
```

Over `expo-sqlite`:

```ts
import * as SQLite from 'expo-sqlite';

const db = await SQLite.openDatabaseAsync('app.db');

export const conn: MigrationConnection = {
  async exec(sql) {
    await db.execAsync(sql);
  },

  async appliedVersions() {
    const rows = await db.getAllAsync<{ version: number }>(`SELECT version FROM "_zmdb_migrations"`);
    return rows.map(r => r.version);
  },

  async appliedMigrations() {
    return db.getAllAsync<{ version: number; name: string; checksum: string | null }>(
      `SELECT version, name, checksum FROM "_zmdb_migrations" ORDER BY version`,
    );
  },

  async recordApplied(version, name, checksum) {
    await db.runAsync(
      `INSERT INTO "_zmdb_migrations" ("version", "name", "applied_at", "checksum") VALUES (?, ?, ?, ?)`,
      version,
      name,
      Date.now(),
      checksum ?? null,
    );
  },

  async recordReverted(version) {
    await db.runAsync(`DELETE FROM "_zmdb_migrations" WHERE "version" = ?`, version);
  },

  async transaction(run) {
    await db.execAsync('BEGIN');
    try {
      const result = await run();
      await db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  },
};
```

The default table is
`_zmdb_migrations(version, name, applied_at, checksum)`. The runner creates it
before reading, so a connection that keeps its own ledger under another name
leaves two unrelated histories.

Then, at startup:

```ts
import { runCli } from '@zmdb/query-compiler/migrations/runner';

await runCli('up', conn, migrations);
```

For the browser with `wa-sqlite` over OPFS the shape is identical — open the
database, implement the four required methods, and add the optional checksum and
transaction methods when the binding can support them.

## The constraints that make client-side migrations different

**Migrations run on a device you do not control.** A user can be four versions behind, so every migration has to apply cleanly from any older state, and you cannot fix a bad one by rolling back — the device already ran it. Ship migrations you have tested from every supported starting version, not just from the previous one.

**There is no maintenance window.** The migration runs while the user is opening the app. A backfill over a large local table is a spinner on launch. Prefer nullable columns and lazy backfill over an eager one.

**Storage can vanish.** OPFS can be evicted; the app can be reinstalled. The client database is a cache with a schema, not a system of record. Design for "empty at version 0" being a normal state.

**`down` is close to useless.** Rolling back an app version does not roll back the database, and a user who downgrades through TestFlight will run old code against a new schema. Make schema changes additive so old code keeps working, and treat `down` as a development convenience.

## Generating migrations for the client

Generation happens on your machine, in Node, at build time — not on the device:

```ts
// scripts/generate-client-migrations.mjs
const ops = diff(JSON.parse(readFileSync('client/snapshot.json', 'utf8')), snapshot([todos, tags]));
writeFileSync('client/migrations/003.ts', render(ops, 'sqlite'));
```

The device only ever imports the finished array, so no diffing code ships in the bundle.

## What it would take

Two thin adapters — `@zmdb/repository/expo-sqlite` and something over `wa-sqlite` — each implementing `Driver` and `MigrationConnection`. Neither is difficult; both would add a peer dependency on a platform package, which is the reason they have not been written rather than a design problem. See [Writing a Driver](./custom-driver.html) if you need one before then; the adapter above is the whole job.

---

See also: [React Native](./connect-react-native.html) · [Migration Runner](./migrations-cli.html) · [Writing a Driver](./custom-driver.html)
