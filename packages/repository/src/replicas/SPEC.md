# SPEC — Read replicas (frozen)

Part of `@zmdb/repository`. A transparent, stateless driver wrapper that routes
reads to replicas and writes (and everything inside a transaction) to the
primary. No hidden global state. Epic #126.

## API

```ts
interface ReplicaOptions {
  primary: Driver;
  replicas: readonly Driver[];
  pick?: (replicas: readonly Driver[]) => Driver; // default: round-robin
}
function withReplicas(opts: ReplicaOptions): Driver;
```

## Routing (frozen)

- A query is a **write** if its SQL (trimmed, upper-cased) starts with
  `INSERT` / `UPDATE` / `DELETE` — routed to `primary`.
- Everything else (`SELECT`, `WITH … SELECT`) is a **read** — routed to a replica
  chosen by `pick` (default round-robin over `replicas`).
- If `replicas` is empty, reads fall back to `primary`.
- Deterministic default: round-robin advances one replica per read call.
- Frozen: the wrapper adds no caching/identity-map; it only chooses a driver and
  delegates `execute`.
