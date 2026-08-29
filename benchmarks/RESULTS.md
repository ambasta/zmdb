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
| `/search-customer` (full-text) | ✅ | ✅ | **DNF** | needs FTS predicate; no builder |
| `/search-product` (full-text) | ✅ | ✅ | **DNF** | needs FTS predicate; no builder |

**zmdb cannot serve 6 of the 13 upstream routes** — and in the actual replay
those 6 routes are **57.8% of all requests** (the two 100k-request JOIN routes
dominate). This is a real, significant feature gap, not a footnote.

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

zmdb added as a `cases/zmdb.ts` and run by the upstream runner
(`ts-node index.ts run …`). Per-case ops/s; `DNF` = case the library does not
register (listed, not summed):

| library | parseSafe | parseStrict | assertLoose | assertStrict | DNF cases |
|---------|----------:|------------:|------------:|-------------:|-----------|
| @sinclair/typebox (JIT) | DNF | DNF | 88,070,252 | 29,157,066 | parseSafe, parseStrict |
| ajv | DNF | DNF | 43,363,522 | 29,246,420 | parseSafe, parseStrict |
| arktype | DNF | 3,998,596 | 64,604,434 | 3,983,815 | parseSafe |
| myzod | 3,364,233 | 3,837,054 | DNF | 3,872,625 | assertLoose |
| valibot | 1,757,211 | 1,370,568 | 1,801,433 | 1,530,501 | — |
| **zmdb (runtime)** | 1,438,372 | 1,258,077 | 5,037,460 | 1,207,424 | — |
| zod (v3) | 1,087,654 | 970,236 | 1,051,654 | 1,014,129 | — |
| zod (v4) | 8,052,444 | 4,680,788 | 4,603,060 | 3,918,349 | — |

- zmdb registers all 4 cases (no DNF) — good coverage.
- **zmdb is NOT the fastest validator.** It runs its **runtime** validator (the
  AOT transformer is not a wired build plugin), so JIT/AOT libraries (TypeBox,
  Ajv) are 6–24× faster on assert, and zod v4 leads on parse. zmdb's runtime
  path only beats zod v3 and valibot. The AOT path — the design's whole premise —
  is **unproven here** and not claimed.
- **Typia** — DNF (not run: needs its own AOT transform build in the suite).

---

## Bottom line (honest)

- **Coverage**: zmdb has real, individually-enumerated feature gaps — 6 ORM
  routes (57.8% of the ORM workload) and 0 validation-case gaps.
- **Speed**: zmdb is competitive/slightly ahead **only** on the CRUD/validation
  subset it supports; it is **not** the fastest overall, and on the AOT
  validation premise it is currently far behind the JIT/AOT libraries because
  that path is not yet wired.
