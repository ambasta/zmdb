# Benchmarking Harness — Frozen Spec (Issue #69)

> Status: **FROZEN** for TDD. Implementation (#70–#73) must satisfy this spec.
> Lives in the top-level `benchmarks/` workspace (never published). Node 26+, ESM, TS 7.

## 1. Workspace layout

```
benchmarks/
├── SPEC.md                 # this file
├── src/
│   ├── results.ts          # Result type + schema validator + report helpers
│   ├── validation/         # moltar-style validation suite adapter + runner (#70)
│   └── orm/                # drizzle-style ORM suite adapter + seed + runner (#71)
├── harness/
│   ├── validation/         # the actual moltar suite participation
│   ├── orm/                # the actual drizzle-benchmarks HTTP+k6 participation
│   └── framework/          # the actual the-benchmarker/web-frameworks participation (@zmdb/web)
├── RESULTS.md              # generated comparative report (#72)
└── results.json            # generated machine-readable results (#72)
```

## 2. Result record schema (frozen)

```ts
type ResultStatus = 'ok' | 'dnf';

interface BenchResult {
  readonly suite: 'validation' | 'orm';
  readonly case: string;        // stable case id, e.g. "safe-parse" or "orders-with-items"
  readonly target: string;      // "zmdb" | "typia" | "zod" | "drizzle" | "prisma" | ...
  readonly status: ResultStatus;
  readonly opsPerSec?: number;  // present when status === 'ok'
  readonly dnfReason?: string;  // required when status === 'dnf'
}
```

Rules:
- `status: 'ok'` MUST carry `opsPerSec`.
- `status: 'dnf'` MUST carry a non-empty `dnfReason`.
- **DNF is a first-class value.** An in-scope case is NEVER silently omitted:
  it appears as `ok` (with a score) or `dnf` (with a reason).

## 3. DNF reason taxonomy (frozen)

- `dnf (anti-pattern): <detail>` — the case only makes sense for a pattern zmdb
  rejects (identity map, proxy lazy-load, active-record save). Permitted to skip
  execution but MUST still appear as a DNF row.
- `dnf (not implemented): <detail>` — a supported-in-principle case we have not
  wired yet. MUST appear as a DNF row until implemented.

## 4. Validation case matrix (moltar) — suite `validation`

| case id | definition | zmdb entry point | expected status |
|---------|-----------|------------------|-----------------|
| `safe-parse` | validate + strip excess keys | `parse<T>` (strip) | ok |
| `strict-parse` | validate + reject excess keys | `parse<T>` (strict) / `equals<T>` | ok |
| `loose-assert` | assert, allow excess | `is<T>` / `assert<T>` | ok |
| `strict-assert` | assert, reject excess (nested) | `assertEquals<T>` | ok |

Competitors: typia, zod, @sinclair/typebox, ajv. All four cases are in scope for zmdb.

## 5. ORM case matrix (drizzle) — suite `orm`

| case id | definition | zmdb path | expected status |
|---------|-----------|-----------|-----------------|
| `customer-by-id` | point lookup by PK | `findById` | ok |
| `products-search` | filtered list + pagination | query-compiler where/limit/offset | ok |
| `order-with-items` | nested order + line items | relations `populate` (JOIN/batched) | ok |
| `top-products` | aggregation (group/count) | query-compiler aggregate SQL | ok |
| `prepared-reuse` | reuse a prepared statement | `CompiledQuery` reuse | ok |
| `lazy-relation-graph` | proxy lazy-load traversal | — | dnf (anti-pattern) |
| `identity-map-dedup` | shared refs within a request | — | dnf (anti-pattern) |
| `active-record-save` | `entity.save()` mutation | — | dnf (anti-pattern) |

Competitors: drizzle, prisma, kysely.

## 6. Determinism & reproducibility

- Pinned dataset size + pinned competitor versions.
- Isolated processes per target (matches moltar's methodology).
- Report output has stable ordering (by suite, then case, then target).

## 7. Non-goals (rejected)

- Benchmarking anti-pattern-only capabilities as if we supported them.
- Silently dropping any in-scope case (must be DNF instead).
