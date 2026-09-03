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

## The rule is SQL-shaped, and that is a constraint on anything non-SQL

`isWrite` reads `query.text`. It is the only place in `@zmdb/repository` that makes a routing decision by
inspecting SQL, and it works because `CompiledQuery` is SQL text — a fact
`@zmdb/query-compiler`'s `src/targets/SPEC.md` §2.2 records against this file, since a query object with no
`text` would not fail here. It would return `false` and send every write to a replica.

That is not a defect to fix now: there is no non-SQL target and none is planned. It is the reason the
routing rule is a prefix test rather than a capability the `Driver` declares, and it is the first thing a
future target has to answer, because the failure is a silent one.
