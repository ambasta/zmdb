# SPEC — First-party driver adapters (frozen)

Epic #209. Ships official `Driver` implementations so users don't hand-write one.
A `Driver` is `{ execute(query: CompiledQuery): Promise<readonly Record<string,
unknown>[]> }`. Adapters are thin, dependency-injected wrappers — the repository
still never opens connections itself.

## API

```ts
// node:sqlite (built-in, zero external deps)
import { DatabaseSync } from 'node:sqlite';
function sqliteDriver(db: DatabaseSync): Driver;

// pg (node-postgres) — pass a Pool or Client
import type { Pool, Client } from 'pg';
interface PgOptions {
  prepared?: boolean;
} // opt-in server-side prepared stmts
function pgDriver(client: Pool | Client, opts?: PgOptions): Driver;
```

## Frozen behaviour

### sqliteDriver (#212)

- `execute(q)`: `db.prepare(q.text)`, spread positional `?` params.
- If the SQL is a read (`^\s*SELECT`) or has `RETURNING`, return `stmt.all(...params)`
  as rows; otherwise `stmt.run(...params)` and return `[]`.
- Synchronous under the hood, wrapped in a resolved Promise.

### pgDriver (#213)

- `execute(q)`: `client.query(q.text, q.parameters)` → return `result.rows`.
- With `opts.prepared === true`, use a stable statement `name` derived from the
  SQL text so Postgres caches the plan (server-side prepared statement). Kept
  opt-in to preserve the zero-state default (see the benchmarks tail trade-off).
- Never mutates the pool/client; no connection lifecycle management.

## Packaging

- Exposed as `@zmdb/repository/drivers/sqlite` and `@zmdb/repository/drivers/pg`.
- `pg` is an **optional peer/dev** dependency of the repo (the sqlite driver has
  zero external deps); importing the pg driver without `pg` installed fails
  clearly, not silently.

## Acceptance

- sqlite driver: E2E against an in-memory `node:sqlite` DB — create/find/list/
  update/delete round-trips (always runs, no external service).
- pg driver: unit test with a fake `query` recorder asserts it calls
  `query(text, params)` and returns `.rows`; prepared mode passes a stable `name`.
  (Live-PG E2E self-skips when unreachable.)
