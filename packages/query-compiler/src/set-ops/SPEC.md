# SPEC — Set operations + Batch (frozen)

Part of `@zmdb/query-compiler`. Pure string compilation, parameterized,
dialect-aware. No proxies. ESM, Node 26, TS 7. Epic #118.

## 1. Set operations (#119/#120/#121)

```ts
type SetOp = 'union' | 'unionAll' | 'intersect' | 'except';
function setOperation(op: SetOp, queries: readonly CompiledQuery[], dialect): CompiledQuery;
```

- Combines ≥2 compiled queries with `UNION` / `UNION ALL` / `INTERSECT` /
  `EXCEPT`, in the given order.
- Parameter lists are concatenated in query order; placeholders in later queries
  are **renumbered** for dialects with positional placeholders (postgres `$n`),
  left as `?` for mysql/sqlite.
- Golden (postgres): `union` of `SELECT ... $1` and `SELECT ... $1` ⇒
  `SELECT ... $1 UNION SELECT ... $2` with `parameters=[a,b]`.
- Frozen: a single-query input returns it unchanged; empty input throws.
- Row shapes must be union-compatible (caller's responsibility; documented).

## 2. Batch API (#122/#123/#124)

```ts
interface BatchStatement { text: string; parameters: readonly unknown[]; }
function batch(statements: readonly CompiledQuery[]): { statements; execute(runner) }
```

- Bundles N statements for a single round-trip where the driver supports it.
- `execute(runner)` calls `runner(statements)` once and returns the per-statement
  results in order. Frozen: order preserved; empty batch ⇒ empty result, runner
  not called.
- No implicit transaction — batching is a transport concern; wrap in
  `db.transaction` for atomicity.
