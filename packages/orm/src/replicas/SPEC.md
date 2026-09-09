# SPEC — Read replicas (frozen)

Part of `@zmdb/orm`. A transparent, stateless driver wrapper that routes reads to replicas and writes (and everything inside a transaction) to the primary. No hidden global state. Epic #126.

## API

The canonical signatures are [`ReplicaOptions` and `withReplicas`](./index.ts). When the primary supports transactions, the wrapper preserves that capability and delegates each transaction to the
primary.

## Routing (frozen)

- Every compiled query carries immutable execution effects. `requiresPrimary: true` routes to `primary`.
- Only a declared `SELECT` with `requiresPrimary: false` may use a replica chosen by `pick` (default round-robin). Writes, DDL, unknown raw statements and locking reads require the primary. Nested
  statements and set operations preserve any primary requirement.
- If `replicas` is empty, reads fall back to `primary`.
- Deterministic default: round-robin advances one replica per read call.
- Frozen: the wrapper adds no caching/identity-map; it only chooses a driver and delegates `execute`, including its options.
- The wrapper exposes `stream` only when the primary and every possible replica expose it. Streaming uses the same routing rule and forwards `ExecuteOptions`.

## Execution metadata

The statement builder derives effects while compiling SQL. The wrapper reads `query.effects.requiresPrimary`; it never parses SQL text. Raw-query callers must declare their effects explicitly. An
unknown operation requires primary execution, and the old `isWrite` text scanner is removed.

`returnsRows` describes whether the statement produces rows, including writes with returning output. Native driver result metadata may establish that fact directly. Comments and literals do not affect
routing or row-return mode. Query decorators preserve effects when forwarding statements.
