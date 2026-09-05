> [!NOTE] React Native and Expo are supported through the Metro transform and a structural SQLite adapter. `node:sqlite` does not exist on device, and zmdb deliberately does not make `expo-sqlite` or
> `op-sqlite` a peer dependency. Choose the binding for the app and map it to the small `Driver` below.

## What runs on device unchanged

Most of zmdb, because most of it has no I/O:

- the declaration and `Entity<T>` / `CreateDTO<T>` / `WhereDTO<T>` — types only
- `createQueryCompiler(...).compile()` — string manipulation
- `snapshot()`, `diff()`, `emitUp()` — pure functions
- the AOT validators, `toJsonSchema` — generated code

The platform-specific part is the last inch: something that runs `{ text, parameters }`.

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

Metro does not run TypeScript custom transformers, so zmdb wraps its Babel-transformer seam instead. The supported range is Metro `>=0.87.0 <0.88.0`.

Bare React Native:

```js
// metro.config.js
const { getDefaultConfig } = require('@react-native/metro-config');
const { withZmdb } = require('@zmdb/aot-validator/metro');

module.exports = withZmdb(getDefaultConfig(__dirname));
```

Expo uses the same wrapper around Expo's default config:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withZmdb } = require('@zmdb/aot-validator/metro');

module.exports = withZmdb(getDefaultConfig(__dirname));
```

`withZmdb` preserves the existing `babelTransformerPath`, including Expo's or an app-supplied transformer, and delegates to it after applying the same transform as the unplugin and `zmdb-codegen`.
There is no Expo config plugin; config plugins run at prebuild and cannot configure the later Metro process.

This is the configuration exercised by `fixtures/consumer-metro`: a real Metro 0.87 bundle with an existing custom transformer. The fixture asserts that the schema is inlined, no runtime `schemaOf`
call survives, and the Metro, plugin, and CLI routes emit the same check.

If loading the TypeScript project in every Metro worker uses too much memory, lower the pool explicitly:

```js
module.exports = withZmdb(getDefaultConfig(__dirname), { workerCount: 2 });
```

You should not normally clear Metro's cache. The cache key includes the zmdb version, transformer options, `tsconfig.json`, and the path, size and mtime of each project source, so a new build
invalidates stale output after any of those changes.

The exception is an already-running dev server after a cross-file type change: Metro re-runs the file that changed, but it does not know which other files generated checks from that type. Restart with
`--reset-cache`; for Expo use `expo start --clear`. An ordinary edit to the transformed file itself needs no manual reset.

An unconfigured `schemaOf<T>()` or generic validator call still throws its [untransformed-build error](./gotchas.html). Keep a canary against the real bundle:

```ts
it('validators are transformed', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

See [AOT Setup](./aot-setup.html).

## Migrations on device

Run `zmdb embed` during the build, map the same SQLite handle onto the three-method `EmbeddedConnection`, and call `runEmbedded` at startup. The full example is on
[Web & Mobile Migrations](./migrations-web-mobile.html), including checksum and downgrade refusal, why `down` is nearly useless on a device, and why every migration must apply from any older version.

## Design constraints that are not zmdb's

**The database is a cache with a schema.** Reinstall or eviction means empty; "empty at version 0" must be a normal state.

**Migrations run while the user waits.** A backfill over a large local table is a launch spinner. Prefer nullable columns and lazy backfill.

**Sync is your problem.** zmdb has no sync engine. Either write one over your API — see [HTTP Proxy](./connect-http-proxy.html) for the transport shape — or use a sync-first backend and zmdb only for
local reads.

## Why the SQLite adapter stays in the app

The `Driver` and `EmbeddedConnection` boundaries are structural, while the native binding is an application choice: Expo's binding, `op-sqlite`, SQLCipher, or a future platform package. Keeping the
adapter here avoids making every repository consumer install a mobile peer dependency. A first-party `@zmdb/repository/expo-sqlite` package would be a convenience wrapper, not a missing execution
path.

---

See also: [Web & Mobile Migrations](./migrations-web-mobile.html) · [Dialect: SQLite](./dialect-sqlite.html) · [AOT Setup](./aot-setup.html)
