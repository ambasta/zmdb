# Benchmark Results (real upstream suites, honest accounting)

> zmdb run inside the **actual upstream benchmark harnesses** against **real
> competitor libraries**. Reproduction: [`harness/`](./harness).
> Environment: local dev box, Node 26.8.1, real PostgreSQL 16 (podman).

---

## ORM — drizzle-benchmarks (real methodology: HTTP servers + k6)

This is the upstream method: one **HTTP server per ORM** (each using its own
query builder over the same `pg` pool + real Northwind data — 10k customers /
50k orders / 308k order-details), driven by the upstream **k6** request replay
(`data/requests.json`). Servers built from the upstream routes; run via the
harness in `harness/orm/`.

### Feature coverage — each route listed individually (not summed)

Every upstream route is listed on its own — no scoring, no aggregation into a
single number. All 13 are now served (HTTP 200 with correct data); the "why"
column records how each formerly-DNF route was closed.

| Route | drizzle | kysely | zmdb | how the zmdb gap was closed |
|-------|:-------:|:------:|:----:|--------------|
| `/customers` (list+paginate) | ✅ | ✅ | ✅ | (already served) |
| `/customer-by-id` | ✅ | ✅ | ✅ | (already served) |
| `/employees` | ✅ | ✅ | ✅ | (already served) |
| `/suppliers` | ✅ | ✅ | ✅ | (already served) |
| `/supplier-by-id` | ✅ | ✅ | ✅ | (already served) |
| `/products` | ✅ | ✅ | ✅ | (already served) |
| `/order-with-details-and-products` | ✅ | ✅ | ✅ | 2-query populate (always supported) |
| `/employee-with-recipient` | ✅ | ✅ | ✅ (now served, #88) | JOIN builder wired (self-join) |
| `/product-with-supplier` | ✅ | ✅ | ✅ (now served, #88) | JOIN builder wired |
| `/orders-with-details` (agg list) | ✅ | ✅ | ✅ (now served, #93) | aggregate builder (GROUP BY on FK) |
| `/order-with-details` (agg by id) | ✅ | ✅ | ✅ (now served, #93) | aggregate builder (GROUP BY on FK) |
| `/search-customer` (full-text) | ✅ | ✅ | ✅ (now served, #97) | FTS builder wired (`whereMatch`) |
| `/search-product` (full-text) | ✅ | ✅ | ✅ (now served, #97) | FTS builder wired (`whereMatch`) |

**As originally measured, zmdb served only 7 of the 13 upstream routes** — the 6
join/aggregate/FTS routes were DNF, and in the actual replay those routes are
**57.8% of all requests** (the two 100k-request JOIN routes dominate). That was
a real, significant feature gap.

> **Status update — all 13 routes now served (0 DNF):** the query-compiler gained
> JOIN (`joinableSelectFrom`, #85), aggregation (`aggregateSelectFrom`, #90), and
> full-text-search (`ftsSelectFrom`, #95) builders, and every previously-DNF
> route is now wired and returns **HTTP 200 with correct data**, verified against
> real Postgres:
> - **FTS** `/search-customer`, `/search-product` — FTS builder (#97).
> - **JOIN** `/employee-with-recipient` (self-join), `/product-with-supplier` —
>   JOIN builder (#88). Repository `findJoined` also passes E2E (#87).
> - **Aggregates** `/orders-with-details`, `/order-with-details` — aggregate
>   builder grouping on the FK in `order_details` (#93); order 10500 → count 15,
>   sum 1038, cross-checked vs raw SQL. Repository `aggregate` passes E2E (#92).
>
> **Honest caveats:** (1) the aggregate routes return the per-order aggregate
> shape (`order_id`, `products_count`, `quantity_sum`) via GROUP-BY on the child
> table — zmdb's aggregate builder does **not** join in the parent `orders`
> columns (shipName, etc.), so the shape differs slightly from drizzle/kysely's
> joined projection while the aggregate values match. (2) k6 has now been **re-run
> over the full 13-route replay** (see throughput below): zmdb is marginally
> ahead on req/s but kysely has the best p95 — a close, mixed result, **not** a
> "fastest ORM" claim.

### Throughput — k6, FULL 13-route replay (all three serve every route, 0 failures)

Now that zmdb serves all 13 routes, k6 was re-run over the **full** upstream
replay (every route, including the expensive `/search-*` full-text queries) —
all three ORMs return 200 on every request:

| ORM | req/s | p95 latency | failed |
|-----|------:|------------:|-------:|
| **zmdb** | **2,849** | 214 ms | 0 |
| kysely | 2,782 | 171 ms | 0 |
| drizzle | 2,593 | 209 ms | 0 |

- **Honest read:** zmdb is marginally ahead on throughput but **kysely has the
  best p95 latency** — this is a genuinely close, mixed result, not a zmdb
  blowout. On a prior CRUD-only run (below) zmdb led more clearly; adding the
  join/aggregate/FTS routes narrows it.
- Absolute numbers are low because of the short ramp (see below) and because the
  full replay includes the heavy FTS routes. Rankings can swap run-to-run within
  a few %.

#### Earlier CRUD-subset run (for reference, pre-wiring)

Before the join/aggregate/FTS routes were wired, a k6 run on just the shared
CRUD routes (156,999 requests, 0 failures) showed: zmdb 6,666 req/s (p95 90ms) ·
kysely 6,388 (90ms) · drizzle 4,789 (128ms). Kept for context; the full-13 run
above supersedes it as the honest comparison.

### Not run here (stated, not faked)

- **Prisma** — DNF (not implemented: engine/codegen not installed).
- The upstream k6 profile ramps to **3000 VUs over ~10 min**; we used a shorter
  fixed ramp (to 400 VUs, ~25 s) so it completes in this environment. Same k6
  script + same replay list; absolute numbers are lower than a big-iron run.

---

## Validation — typescript-runtime-type-benchmarks (upstream runner)

zmdb added as **two** cases in the upstream runner (`ts-node index.ts run …`):
`zmdb` (the shipped **runtime** validator) and `zmdb-aot` (the **AOT-inlined**
path). Per-case ops/s; `DNF` = case the library does not register:

| library | parseSafe | parseStrict | assertLoose | assertStrict | DNF cases |
|---------|----------:|------------:|------------:|-------------:|-----------|
| typia (AOT) | 100,673,513 | 38,869,470 | 78,128,590 | 31,056,106 | — |
| **zmdb-aot** (hand-inlined¹) | 98,435,060 | 13,229,339 | 87,800,788 | 14,020,476 | — |
| @sinclair/typebox (JIT) | DNF | DNF | 88,070,252 | 29,157,066 | parseSafe, parseStrict |
| ajv | DNF | DNF | 43,363,522 | 29,246,420 | parseSafe, parseStrict |
| zod (v4) | 8,711,299 | 4,895,742 | 4,173,432 | 4,172,722 | — |
| arktype | DNF | 3,998,596 | 64,604,434 | 3,983,815 | parseSafe |
| myzod | 3,364,233 | 3,837,054 | DNF | 3,872,625 | assertLoose |
| valibot | 1,757,211 | 1,370,568 | 1,801,433 | 1,530,501 | — |
| **zmdb** (runtime, shipped) | 1,430,813 | 1,101,908 | 5,173,050 | 1,162,280 | — |
| zod (v3) | 1,087,654 | 970,236 | 1,051,654 | 1,014,129 | — |

¹ **The AOT transformer now exists and is wired** (`@zmdb/aot-validator/plugin`,
epics #75/#79–#83): #82 built a validator through the real transform and measured
it at **~58–63× the runtime path** on this box, and #83's acceptance gate asserts
AOT ≥5× runtime. The specific per-case ops/s in this table, however, are from the
**hand-inlined preview** (the exact shape the transformer emits) run through the
upstream moltar runner — the full moltar matrix has **not been re-run through the
built plugin yet**, so these cells are labelled as the preview, not conflated
with the shipped runtime row.

### What this shows (honestly)

- **The AOT premise holds and the transformer is now real.** `zmdb-aot` is
  **6–8× faster than the `zmdb` runtime** on the moltar cases, and the *built*
  transform (#82) measured ~58–63× runtime on a nested fixture. On
  parseSafe/assertLoose it is in typia's league and **far ahead of zod v4** (the
  case that motivated this).
- **But we are not the outright winner.** **typia beats `zmdb-aot` on both
  strict cases** (parseStrict 39M vs 13M; assertStrict 31M vs 14M) — its
  excess-key checking is more optimized than our current strict inlining. On the
  strict path, TypeBox/Ajv also lead. Closing that is a tracked perf task.
- **The shipped, out-of-the-box path is still the `zmdb` runtime** unless the
  transformer plugin is enabled in the consumer's build. With the plugin, code
  gets the AOT path; without it, the runtime path loses to zod v4 on 3 of 4 cases.

---

## Bottom line (honest)

- **Coverage**: zmdb now serves **all 13 ORM routes (0 DNF)** — joins,
  aggregates, and FTS builders were added (#85/#88, #90/#93, #95/#97) and each
  formerly-DNF route returns HTTP 200 with correct data on real Postgres. One
  caveat: the aggregate routes return a per-order aggregate projection, not the
  parent-joined projection drizzle/kysely emit. Validation: **0 case gaps**.
- **Validation speed**: the AOT path is real (transformer wired, #75/#82/#83) and
  is **6–8× the runtime path**, beating zod v4 and matching typia on
  parse-safe/assert-loose — but **typia still wins the strict cases**, and
  out-of-the-box (plugin not enabled) the shipped runtime path loses to zod v4 on
  3 of 4 cases.
- **ORM speed**: on the **full 13-route k6 run**, zmdb is marginally ahead on
  throughput (2,849 vs kysely 2,782 vs drizzle 2,593 req/s) but **kysely has the
  best p95 latency** — a close, mixed result. **No overall "fastest" claim** is
  made; the lead is within run-to-run noise and the aggregate routes use a
  different projection shape.
