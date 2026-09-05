# `@zmdb/jobs-postgres` — node-postgres `JobStore` adapter

> Frozen by #654 for epic #653. This directory intentionally contains only this specification until #661 implements the separately installed adapter. Issue #650 removed the former
> `@zmdb/web/queues/backends/pg` implementation and peer rather than retaining a forwarding bridge.

## 1. Boundary and exports

```ts
export type PgJobClient = Pool | PoolClient | Client;

export interface PgJobStoreOptions {
  readonly prepared?: boolean;
  readonly maxCacheSize?: number;
  readonly cancelVia?: PgJobClient;
}

export function createPgJobStore(client: PgJobClient, options?: PgJobStoreOptions): JobStore;
```

The root is the only export. It depends on `@zmdb/jobs` at `workspace:^` and declares one required external peer, `pg@^8.23.0`; release tests use `pg@8.23.0` and `@types/pg@^8.23.1`.

The package implements the structural `JobStore` port. It does not own queue SQL, workers, scheduling, migrations or a second job state machine.

## 2. Lifecycle

The caller creates and owns the `Pool`, `PoolClient` or `Client`. The adapter creates no connection and exposes no close method; it neither calls `end()` nor releases a supplied client.

Every execution preserves the input SQL and parameters, returns the peer's rows and reports `dialect: 'postgres'`. Prepared-statement caching and cancellation retain the bounded options of the
official node-postgres driver without importing private repository source.

## 3. Migration and installation

`@zmdb/web/queues/backends/pg` is removed with no forwarding subpath. Core `@zmdb/jobs` retains its SQLite memory backend and declares no `pg` peer.

```sh
yarn add @zmdb/jobs-postgres pg
```

## 4. Required evidence

1. Type tests accept `Pool`, `PoolClient` and `Client`, reject an arbitrary `JobStore`, and expose the exact return type.
2. A required release lane connects to the declared PostgreSQL version, executes a parameterized query through the adapter, then proves the same caller-owned pool remains usable. The current
   warn-and-return path when PostgreSQL is unreachable is local convenience, not release evidence.
3. A packed external jobs app installs the peer, imports the root and typechecks/runs without repository or web source mappings.
4. Manifest and graph checks prove that this package alone owns the `pg` peer for jobs and that importing core jobs does not load it.
