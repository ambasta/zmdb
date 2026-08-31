> **ToDo / feature gap.** The migration runner needs a `MigrationConnection`, and
> the browser and React Native have no such connection out of the box. Nothing in
> zmdb ships an adapter for `wa-sqlite`, `sql.js`, OPFS, `expo-sqlite` or
> `op-sqlite`. `node:sqlite` is a Node built-in and is not available in either
> environment. See also [React Native](./connect-react-native.html).

## What actually transfers

Most of zmdb does, because most of it is types and string manipulation:

- `defineSchema`, `Entity`, `CreateDTO`, `WhereDTO` — types, no runtime
- `createQueryCompiler(...).compile()` — produces `{ text, parameters }`, no I/O
- `snapshot()`, `diff()`, `emitUp()` — pure functions over plain objects
- the AOT validators — generated code, no platform dependency

What does not transfer is the last inch: something that takes `{ text, parameters }` and runs it.

## Implementing the connection

`MigrationConnection` is four methods, and that is the whole contract:

```ts
interface MigrationConnection {
  exec(sql: string): Promise<void>;
  appliedVersions(): Promise<readonly number[]>;
  recordApplied(version: number, name: string): Promise<void>;
  recordReverted(version: number): Promise<void>;
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
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS "_migrations" ("version" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
    );
    const rows = await db.getAllAsync<{ version: number }>(`SELECT version FROM "_migrations"`);
    return rows.map(r => r.version);
  },

  async recordApplied(version, name) {
    await db.runAsync(`INSERT INTO "_migrations" ("version", "name") VALUES (?, ?)`, version, name);
  },

  async recordReverted(version) {
    await db.runAsync(`DELETE FROM "_migrations" WHERE "version" = ?`, version);
  },
};
```

Then, at startup:

```ts
import { runCli } from '@zmdb/query-compiler/migration-runner';

await runCli('up', conn, migrations);
```

For the browser with `wa-sqlite` over OPFS the shape is identical — open the database, implement four methods.

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
