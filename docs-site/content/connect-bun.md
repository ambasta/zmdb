Bun runs zmdb unchanged — it is ESM-only TypeScript with no native code — and Bun's built-in SQL clients make the drivers shorter than their Node equivalents.

## SQLite, with `bun:sqlite`

```ts
import { Database } from 'bun:sqlite';
import type { Driver } from '@zmdb/repository';

const db = new Database('app.db', { strict: true });
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

export const driver: Driver = {
  async execute(query) {
    const stmt = db.query(query.text);
    return stmt.all(...(query.parameters as never[])) as Record<string, unknown>[];
  },
};
```

`bun:sqlite` returns `[]` for statements with no results, so there is no need for the read/write branch that `node:sqlite` needs.

## Postgres, with `Bun.sql`

```ts
import { SQL } from 'bun';

const sql = new SQL(requireEnv('DATABASE_URL'));

export const driver: Driver = {
  async execute(query) {
    return (await sql.unsafe(query.text, query.parameters as never[])) as Record<string, unknown>[];
  },
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the
first query.

`unsafe` means "not from a template tag" — the parameters are still bound, not interpolated.

## The transformer

This is the one thing to get right, and it is where Bun projects go wrong.

Bun's own transpiler does not run TypeScript custom transformers, so `is<T>()` and `assert<T>()` compile to calls with no descriptor — and [silently accept everything](./gotchas.html). Bun's `--bun`
runtime does not fix this; the transform has to happen at build time.

**Build with `tsc` (or tsup) and run the output:**

```json
{
  "scripts": {
    "build": "tsup",
    "start": "bun run dist/index.js"
  }
}
```

**Then prove it, in a test that runs against the built output:**

```ts
it('validators are transformed', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

If that test passes with an untransformed build, it will return `true` and you will know. Every Bun project using the validators should have it. See [AOT Setup](./aot-setup.html).

Everything else — the compiler, the repository, the DTO types, `@zmdb/web` — is plain TypeScript and needs no transformer, so a Bun-native workflow is fine if you are not using the validators.

## `Bun.serve` with `@zmdb/web`

`WebApplication` exposes `fetch(request)`, which is exactly `Bun.serve`'s handler signature:

```ts
import { createApp } from '@zmdb/web';

const app = createApp(AppModule);
await app.init();

Bun.serve({ port: 3000, fetch: app.fetch });
```

No adapter. See [Standalone Applications](./web-standalone.html).

## Testing

`bun test` works, with the same transformer caveat — a test importing source directly gets untransformed validators. Either run the suite against built output, or use `vitest`, which the project's own
tests use and which supports the transformer through its TypeScript pipeline.

---

See also: [AOT Setup](./aot-setup.html) · [Connect: SQLite](./connect-sqlite.html) · [Standalone Applications](./web-standalone.html)
