# Benchmark Results (real, comparative)

> zmdb benchmarked head-to-head against **real, installed competitor libraries**
> on the **actual upstream benchmark workloads**. Reproduction harnesses live in
> [`harness/`](./harness).
>
> Environment: local dev box, Node 26.8.1. ORM runs against **real PostgreSQL 16**
> (podman container) loaded with the drizzle-benchmarks Northwind dataset
> (10,000 customers / 50,000 orders / 308,224 order-details). ops/s are
> `tinybench` hz — indicative of this machine, not an official ranking.

## Honesty notes (read first)

- **zmdb validation runs via its RUNTIME validator, not the AOT-inlined path.**
  zmdb's AOT transformer (`transformSource`) is not yet wired as a ttypescript/
  ts-patch build plugin, so the AOT numbers cannot honestly be claimed. The
  runtime path is what is measured and labelled below. Wiring the real
  transformer is the prerequisite for an apples-to-apples comparison with
  Typia's AOT output.
- **Typia is DNF (not wired: needs typia AOT build)** — it cannot run without
  its own AOT transform step; running it untransformed would misrepresent it.
- **ORM = real PostgreSQL.** All three ORMs run against the same live PG
  instance over the same `pg` pool, so numbers isolate query-building +
  result-mapping overhead. (No SQLite.)
- **Prisma is DNF (not implemented)** — its engine/codegen was not installed.
- The upstream drizzle-benchmarks also drives load with **k6** across two
  machines; that distributed throughput rig is **DNF (not implemented)** here.
  These numbers are single-process `tinybench` hz against the same DB.

## Validation suite (moltar data model, 4 case kinds)

Real libraries: zod 3.25, @sinclair/typebox 0.34 (compiled), ajv 8.20,
valibot 1.4, zmdb (runtime). ops/s (higher = faster):

| Case | typebox | ajv | zmdb (runtime) | valibot | zod |
|------|--------:|----:|---------------:|--------:|----:|
| parseSafe    | n/a¹ | n/a¹ | **3,862,464** | 1,477,430 | 935,377 |
| parseStrict  | n/a¹ | n/a¹ | **1,299,025** | n/a | 887,924 |
| assertLoose  | **24,355,192** | 19,580,836 | 3,716,008 | 1,590,291 | 923,484 |
| assertStrict | **30,411,817** | 25,264,303 | 1,788,074 | n/a | 946,149 |

¹ typebox/ajv are schema-check libraries (loose/strict *assert*) with no
parse-and-strip step, so those cells are n/a.

- On **assert**, JIT-compiled TypeBox / Ajv are ~7–17× faster than zmdb's
  *runtime* validator — expected, since zmdb is not yet AOT here.
- On **parse** (validate + return), zmdb's runtime path already leads zod and
  valibot. The AOT transform (when wired) targets closing the assert gap; that
  remains unproven and is not claimed.
- **Typia**: DNF (not wired: needs typia AOT build).

## ORM suite (drizzle-benchmarks Northwind, REAL PostgreSQL 16)

Real libraries: drizzle-orm 0.36 (node-postgres), kysely 0.29 (PostgresDialect),
zmdb query-compiler (→ pg). Representative of repeated runs; ops/s (higher = faster):

| Query | zmdb | drizzle | kysely |
|-------|-----:|--------:|-------:|
| customer-by-id       | 12,564 | **12,893** | 11,629 |
| customers-paginated  | **6,774** | 5,795 | 5,932 |
| orders-with-details  | **5,649** | 5,448 | 5,317 |

- All three are within ~10% of each other — expected, since the PostgreSQL
  round-trip dominates and the execution path (`pg` pool) is identical.
- zmdb's thin, allocation-lean query-compiler is competitive with (and on the
  list/join paths slightly ahead of) drizzle and kysely — consistent with the
  zero-overhead design (no proxy/identity-map wrapping of result rows).
- Run-to-run variance is a few %; rankings on the close cases can swap.

### Anti-pattern cases (DNF — visible, not hidden)

zmdb rejects these by architecture, so they are reported `DNF (anti-pattern)`:

| Case | Status |
|------|--------|
| lazy-relation-graph (proxy lazy-load) | DNF (anti-pattern) |
| identity-map-dedup | DNF (anti-pattern) |
| active-record `entity.save()` | DNF (anti-pattern) |

### Not wired here (DNF — not implemented)

| Case | Status |
|------|--------|
| Prisma comparison | DNF (not implemented: prisma engine not installed) |
| k6 distributed throughput rig | DNF (not implemented: single-process tinybench used) |
| Typia validation (AOT) | DNF (not wired: needs typia AOT build) |
