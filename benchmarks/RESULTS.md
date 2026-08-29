# Benchmark Results (real, comparative — exact upstream suites)

> zmdb run as a participant in the **exact upstream benchmark suites**, against
> **real installed competitor libraries**. Reproduction harnesses in
> [`harness/`](./harness).
>
> Environment: local dev box, Node 26.8.1. Validation via the upstream moltar
> runner (`ts-node index.ts run …`). ORM against **real PostgreSQL 16** (podman)
> loaded with the drizzle-benchmarks Northwind dataset (10k customers / 200
> employees / 1k suppliers / 5k products / 50k orders / 308,224 order-details),
> running the exact upstream prepared-query set p1–p13. ops/s = benny/tinybench
> hz — indicative of this machine, not an official ranking.

## Why DNF counts matter

Running the **exact** upstream cases (not a hand-picked subset) means the number
of cases a library **cannot express with its own API** is a real feature-gap
metric. Those show as `DNF`, counted per library below.

## Validation — moltar suite (exact 4 case kinds, upstream runner)

Per-library × per-case ops/s. `DNF` = the library does not register that case.

| library | parseSafe | parseStrict | assertLoose | assertStrict | DNF |
|---------|----------:|------------:|------------:|-------------:|----:|
| @sinclair/typebox (JIT) | DNF | DNF | 88,070,252 | 29,157,066 | 2/4 |
| ajv | DNF | DNF | 43,363,522 | 29,246,420 | 2/4 |
| arktype | DNF | 3,998,596 | 64,604,434 | 3,983,815 | 1/4 |
| myzod | 3,364,233 | 3,837,054 | DNF | 3,872,625 | 1/4 |
| valibot | 1,757,211 | 1,370,568 | 1,801,433 | 1,530,501 | **0/4** |
| **zmdb (runtime)** | 1,438,372 | 1,258,077 | 5,037,460 | 1,207,424 | **0/4** |
| zod (v3) | 1,087,654 | 970,236 | 1,051,654 | 1,014,129 | **0/4** |
| zod (v4) | 8,052,444 | 4,680,788 | 4,603,060 | 3,918,349 | **0/4** |

- **zmdb covers all 4 cases (0/4 DNF)** — same coverage as zod/valibot; more than
  typebox/ajv (assert-only) or arktype/myzod.
- **zmdb runs its RUNTIME validator, not AOT** (the transformer is not a wired
  build plugin), so on `assert` the JIT/AOT libs (typebox, ajv) are far ahead —
  expected and labelled. On `parse`, zmdb's runtime already beats zod v3.
- **Typia**: `DNF (not run)` — needs its own AOT transform build step in the
  suite; running it untransformed would misrepresent it.

## ORM — drizzle-benchmarks suite (exact p1–p13, REAL PostgreSQL)

Each ORM builds each query with its **own builder API**; a query a builder cannot
express is `DNF`. ops/s (higher = faster):

| Query | zmdb | drizzle | kysely |
|-------|-----:|--------:|-------:|
| p1 customers-list (paginated) | 4,444 | 4,681 | 3,436 |
| p2 customer-by-id | 6,868 | 6,865 | 7,379 |
| p3 customer-search (full-text) | **DNF** | 41 | 47 |
| p4 employees-list | 4,745 | 6,276 | 3,741 |
| p5 employee + recipient (self-join) | **DNF** | 9,209 | 7,301 |
| p6 suppliers-list | 5,961 | 8,708 | 5,681 |
| p7 supplier-by-id | 12,203 | 9,632 | 10,385 |
| p8 products-list | 6,488 | 6,531 | 5,663 |
| p9 product + supplier (join) | **DNF** | 3,405 | 3,800 |
| p10 product-search (full-text) | **DNF** | 121 | 119 |
| p11 orders + aggregates (GROUP BY, list) | **DNF** | 2,096 | 2,736 |
| p12 order + aggregates (by id) | **DNF** | 4,379 | 5,211 |
| p13 order-with-details | 4,983 | 4,190 | 4,429 |
| **DNF total (of 13)** | **6** | **0** | **0** |

### What zmdb's 6 DNFs actually are

zmdb's `@zmdb/query-compiler` is deliberately **CRUD-focused** — it has builders
for single-table SELECT/INSERT/UPDATE/DELETE with where/order/limit/offset, but
**no builder for joins, aggregations (GROUP BY / computed columns), or full-text
search**. Those upstream queries (p3, p5, p9, p10, p11, p12) therefore cannot be
expressed with zmdb's builder and are honest `DNF`:

| DNF query | missing zmdb builder capability |
|-----------|--------------------------------|
| p3, p10 | full-text search predicate builder |
| p5, p9 | JOIN builder |
| p11, p12 | JOIN + GROUP BY + aggregate/computed-column builder |

p13 (order-with-details) is **not** DNF: zmdb expresses it as the explicit
two-query populate pattern (parent + batched children), which is the intended
zmdb idiom instead of a join.

- On the 7 queries zmdb can express, it is competitive with drizzle/kysely
  (all within the same range; PG round-trip dominates).
- These 6 DNFs are a genuine roadmap signal: joins, aggregates, and FTS are
  builder features zmdb has not implemented (some, like joins, are partly
  covered by relations `populate` but not as a general query-builder join).

### Not run here (DNF — environment / not implemented)

| Case | Status |
|------|--------|
| Prisma (ORM suite) | DNF (not implemented: engine/codegen not installed) |
| k6 distributed throughput rig | DNF (not implemented: single-process benny/tinybench used) |
| Typia (validation) | DNF (not run: needs its AOT transform build in the suite) |
| Full 60-library moltar matrix | Partial: ran zmdb + zod/zod4/valibot/ajv/myzod/arktype/typebox-JIT (representative set; others omitted for time, not faked) |
