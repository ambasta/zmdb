# `@zmdb/web` — router benchmark & performance verification SPEC

> Prove the route-resolution perf claim + add a microbench (epic #317). Frozen.

## Contract

### The claim to verify
Route resolution reads the **cached** route table built once at
`register`/`compile` time — it does **not** re-read `context.metadata` per
request. This is the concrete, testable form of "no per-request reflection".

### `benchmarkRouter(options)` — a small, honest microbench harness
- Builds a router with N routes, runs `handle` for `iters` iterations, returns
  `{ iters, totalMs, opsPerSec }`. Pure timing via `performance.now()`; no
  scoring, no averaging across unrelated things.
- A companion `metadataReadCount` probe (test-only) asserts the metadata is read
  a **bounded** number of times during setup and **zero** additional times across
  many `handle` calls — the regression guard for init-time resolution.

## Invariants
- The benchmark is honest: real timings, no fabricated numbers; the dashboard
  entry states methodology + caveats (no "fastest" claim).
- **No `as`/`any`/`!` on the consumer surface.**

## Acceptance
- Regression guard: after building the router, `handle` invoked K times performs
  **no additional** `getRoutes`/metadata reads (resolution is init-time).
- `benchmarkRouter` returns a plausible positive `opsPerSec` for a small route
  set (smoke).
- No consumer-surface `as`; suite + typecheck green.
- Dashboard/docs note added honestly (docs sub-issue).

## Out of scope
Cross-framework comparison numbers (documented as methodology; not fabricated in
tests).
