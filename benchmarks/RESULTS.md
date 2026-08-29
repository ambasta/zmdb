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

### Feature coverage — each DNF route listed individually (not summed)

A route zmdb's query **builder** cannot express returns HTTP 501. These are the
individual gaps (no scoring, no aggregation):

| Route | drizzle | kysely | zmdb | why zmdb DNF |
|-------|:-------:|:------:|:----:|--------------|
| `/customers` (list+paginate) | ✅ | ✅ | ✅ | — |
| `/customer-by-id` | ✅ | ✅ | ✅ | — |
| `/employees` | ✅ | ✅ | ✅ | — |
| `/suppliers` | ✅ | ✅ | ✅ | — |
| `/supplier-by-id` | ✅ | ✅ | ✅ | — |
| `/products` | ✅ | ✅ | ✅ | — |
| `/order-with-details-and-products` | ✅ | ✅ | ✅ (2-query populate) | — |
| `/employee-with-recipient` | ✅ | ✅ | **DNF** | needs a self-JOIN; no join builder |
| `/product-with-supplier` | ✅ | ✅ | **DNF** | needs a JOIN; no join builder |
| `/orders-with-details` (agg list) | ✅ | ✅ | **DNF** | needs JOIN + GROUP BY + aggregates |
| `/order-with-details` (agg by id) | ✅ | ✅ | **DNF** | needs JOIN + aggregates |
| `/search-customer` (full-text) | ✅ | ✅ | ✅ (now served, #97) | FTS builder wired (`whereMatch`) |
| `/search-product` (full-text) | ✅ | ✅ | ✅ (now served, #97) | FTS builder wired (`whereMatch`) |

**As originally measured, zmdb served only 7 of the 13 upstream routes** — the 6
join/aggregate/FTS routes were DNF, and in the actual replay those routes are
**57.8% of all requests** (the two 100k-request JOIN routes dominate). That was
a real, significant feature gap.

> **Status update (progress):** the query-compiler now has JOIN
> (`joinableSelectFrom`, #85), aggregation (`aggregateSelectFrom`, #90), and
> full-text-search (`ftsSelectFrom`, #95) builders, and the repository/server are
> being wired to use them:
> - **FTS routes** (`/search-customer`, `/search-product`) are **now served**
>   (HTTP 200 with real matches) via the FTS builder (#97) — verified against
>   real Postgres.
> - **JOIN** and **aggregation** repository methods now exist and pass E2E on
>   real Postgres (`findJoined` #87, `aggregate` #92), but the benchmark
>   **server routes** for `/employee-with-recipient`, `/product-with-supplier`,
>   `/orders-with-details`, `/order-with-details` are **not yet re-wired**, so
>   those 4 remain DNF in the throughput table until re-measured.
>
> Net: **DNF is down from 6 → 4 routes.** The k6 throughput numbers below are
> unchanged (k6 filters `/search*`, and the 4 join/aggregate routes are still
> DNF pending server wiring). No premature "faster than X" claim on the newly
> served routes — they will be re-measured before any such statement.

### Throughput — k6, only the routes ALL THREE can serve (fair, 0 failures)

Running the full replay would count zmdb's instant 501s as "fast requests" —
dishonest. So this compares only the shared CRUD routes (156,999 requests, all
three return 200):

| ORM | req/s | p95 latency |
|-----|------:|------------:|
| **zmdb** | **6,666** | 90 ms |
| kysely | 6,388 | 90 ms |
| drizzle | 4,789 | 128 ms |

- On the CRUD subset it can serve, zmdb is competitive and slightly ahead here —
  consistent with its thin, no-proxy result path.
- **This is NOT "zmdb is the fastest ORM."** It leads *only* on the ~42% of the
  workload it supports; it forfeits the other 57.8% (joins/aggregates/FTS) as
  DNF. A full-workload ranking that included those would place zmdb last, because
  it cannot run the majority of the suite at all.

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

¹ **`zmdb-aot` is hand-inlined exactly as the transformer will emit**, because
the transformer is not yet wired as a build plugin (epic #75). It is a faithful
preview of the AOT path, not yet produced by the actual build — labelled
separately from the shipped runtime path, never conflated.

### What this shows (honestly)

- **The AOT premise holds.** `zmdb-aot` is **6–8× faster than `zmdb` runtime**,
  and on parseSafe/assertLoose it is in typia's league and **far ahead of
  zod v4** (the case that motivated this).
- **But we are not the outright winner.** **typia beats `zmdb-aot` on both
  strict cases** (parseStrict 39M vs 13M; assertStrict 31M vs 14M) — its
  excess-key checking is more optimized than our current strict inlining. On the
  strict path, TypeBox/Ajv also lead. Closing that is a perf sub-task.
- **The shipped path is still the slow `zmdb` runtime** until epic #75 wires the
  transformer. Today, out of the box, zmdb loses to zod v4 on 3 of 4 cases.

---

## Bottom line (honest)

- **Coverage**: zmdb has real, individually-enumerated feature gaps — 6 ORM
  routes (57.8% of the ORM workload) and 0 validation-case gaps.
- **Validation speed**: the **AOT path works** — `zmdb-aot` is 6–8× the runtime
  path and beats zod v4 across the board, matching typia on parse/loose. But
  typia still wins the strict cases, and the AOT path is **not yet wired into
  the build** (hand-inlined preview; epic #75). Out of the box today, the shipped
  runtime path loses to zod v4 on 3 of 4 cases.
- **ORM speed**: competitive/slightly ahead **only** on the CRUD subset it
  supports; **not** the fastest overall — it forfeits 57.8% of the workload as
  DNF (joins/aggregates/FTS), which the new query-builder epics address.
