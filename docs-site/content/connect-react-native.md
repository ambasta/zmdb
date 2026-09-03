> **ToDo / feature gap.** There is no React Native adapter. `node:sqlite` is a
> Node built-in and does not exist on device, and nothing in zmdb ships a
> `Driver` over `expo-sqlite` or `op-sqlite`. The driver below is fifteen lines,
> so this is a missing adapter rather than a missing capability.

## What runs on device unchanged

Most of zmdb, because most of it has no I/O:

- the declaration and `Entity<T>` / `CreateDTO<T>` / `WhereDTO<T>` — types only
- `createQueryCompiler(...).compile()` — string manipulation
- `snapshot()`, `diff()`, `emitUp()` — pure functions
- the AOT validators, `toJsonSchema` — generated code

What is missing is the last inch: something that runs `{ text, parameters }`.

## Over `expo-sqlite`

```ts
import * as SQLite from 'expo-sqlite';
import type { Driver } from '@zmdb/repository';

const db = await SQLite.openDatabaseAsync('app.db');
await db.execAsync('PRAGMA foreign_keys = ON');

export const driver: Driver = {
  async execute(query) {
    const params = [...query.parameters] as SQLite.SQLiteBindValue[];
    // Rows for everything, not only for SELECT: `create`, `update` and `delete` all
    // compile with RETURNING, so a driver that branches on the leading keyword and
    // returns [] for writes makes `create()` hand back an empty entity.
    return await db.getAllAsync<Record<string, unknown>>(query.text, params);
  },
};
```

Then the [SQLite dialect](./dialect-sqlite.html), including its type conversions — `boolean` arrives as `0`/`1`, `timestamp` as text, `json` as text.

## Over `op-sqlite`

```ts
import { open } from '@op-engineering/op-sqlite';

const db = open({ name: 'app.db' });

export const driver: Driver = {
  async execute(query) {
    const res = await db.executeAsync(query.text, [...query.parameters] as never[]);
    return (res.rows?._array ?? []) as Record<string, unknown>[];
  },
};
```

Faster, and it supports SQLCipher if you need the database encrypted at rest — which for anything on a device you should assume you do.

## The transformer

Metro does not run TypeScript custom transformers, so the [validators silently accept everything](./gotchas.html) in a React Native build. That is the trap on this platform.

Two options:

1. **Do not use the validators on device.** The types, compiler and repository all work without the transformer. Validate on the server.
2. **Build the shared code separately.** Compile a `packages/shared` with `tsc` and the transformer, and import the built output from the app. Then add the canary test:

   ```ts
   it('validators are transformed', () => {
     expect(is<{ id: number }>({ id: 'x' })).toBe(false);
   });
   ```

See [AOT Setup](./aot-setup.html).

## Migrations on device

Implement `MigrationConnection` over the same handle and run it at startup — the full example is on [Web & Mobile Migrations](./migrations-web-mobile.html), including why `down` is nearly useless on a device and why every migration must apply from any older version.

## Design constraints that are not zmdb's

**The database is a cache with a schema.** Reinstall or eviction means empty; "empty at version 0" must be a normal state.

**Migrations run while the user waits.** A backfill over a large local table is a launch spinner. Prefer nullable columns and lazy backfill.

**Sync is your problem.** zmdb has no sync engine. Either write one over your API — see [HTTP Proxy](./connect-http-proxy.html) for the transport shape — or use a sync-first backend and zmdb only for local reads.

## What it would take

An `@zmdb/repository/expo-sqlite` entry point with the driver and migration connection above. It adds a peer dependency on a platform package, which is the reason it is not there rather than a design problem.

---

See also: [Web & Mobile Migrations](./migrations-web-mobile.html) · [Dialect: SQLite](./dialect-sqlite.html) · [AOT Setup](./aot-setup.html)
