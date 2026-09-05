# `@zmdb/jobs-postgres` — node-postgres `JobStore` adapter

> Frozen by #654 for epic #653 and implemented by #661. Issue #650 removed the former `@zmdb/web/queues/backends/pg` implementation and peer rather than retaining a forwarding bridge.

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

The root is the only export. It depends on `@zmdb/jobs` and `@zmdb/repository` at `workspace:^` and declares one required external peer, `pg@^8.23.0`; release tests use `pg@8.23.0` and
`@types/pg@^8.23.1`.

The package implements the structural `JobStore` port by delegating to the public `@zmdb/repository/drivers/pg` adapter. It does not own queue SQL, workers, scheduling, migrations or a second job
state machine.

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
2. A required release lane connects to PostgreSQL, executes a parameterized query through the adapter, then proves the same caller-owned pool remains usable. The warn-and-return path when PostgreSQL
   is unreachable is local convenience, not release evidence.
3. The real-server lane proves `prepared: true` reuses a stable server-side statement name and `maxCacheSize` evicts the least-recently-used statement.
4. Two workers sharing one store claim disjoint jobs while their handler executions overlap.
5. A packed external jobs app installs the peer, imports the root and typechecks/runs without repository or web source mappings.
6. Manifest and graph checks prove that this package alone owns the `pg` peer for jobs, core packages do not declare it, and no old web backend or forwarding export remains.
