# [EPIC] Comparative Benchmarking Harness

## Goal

Stand up a reproducible benchmarking harness that measures zmdb against the
industry-standard suites and reports **honest** comparative numbers:

1. **Validation microbenchmarks** — port the case model of
   [moltar/typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
   to exercise `@zmdb/aot-validator` head-to-head with Typia / Zod / TypeBox / Ajv.
2. **End-to-end ORM benchmarks** — port the workload of
   [drizzle-team/drizzle-benchmarks](https://github.com/drizzle-team/drizzle-benchmarks)
   (real PostgreSQL, e-commerce dataset, k6-driven load) to exercise
   `@zmdb/query-compiler` + `@zmdb/repository` head-to-head with Drizzle / Prisma / Kysely.

## Honesty policy (hard requirement)

- **Anti-pattern features** (see below) MAY be dropped from our harness — a
  benchmark that only makes sense for a rejected pattern is out of scope.
- **Every other benchmark case that we do NOT (yet) implement MUST be reported
  as `DNF` (Did Not Finish)** in our results table, with a one-line reason. We
  never silently omit a supported-in-principle case. `DNF` is a first-class,
  visible result value alongside numeric scores.

## Case mapping — validation suite (moltar)

The suite defines four case kinds. Mapping to zmdb:

| Case                                     | zmdb entry point                  | Status    |
| ---------------------------------------- | --------------------------------- | --------- |
| Safe Parsing (strip excess)              | `parse<T>` (strip mode)           | supported |
| Strict Parsing (reject excess)           | `parse<T>` (strict) + `equals<T>` | supported |
| Loose Assertion (allow excess)           | `is<T>` / `assert<T>`             | supported |
| Strict Assertion (reject excess, nested) | `assertEquals<T>`                 | supported |

All four are AOT-compiled for us, so all four are in scope (no DNF expected).

## Case mapping — ORM suite (drizzle)

The suite issues a fixed set of e-commerce queries (customer lookups, product
search, order details with nested items, aggregations, pagination) via k6.
Mapping to zmdb:

| Query class                            | zmdb path                               | Status                 |
| -------------------------------------- | --------------------------------------- | ---------------------- |
| Point lookups by id                    | `findById`                              | supported              |
| Filtered list / pagination             | query-compiler `where`/`limit`/`offset` | supported              |
| Joins / nested order+items             | relations `populate` (JOIN/batched)     | supported              |
| Aggregations (count/group)             | query-compiler raw aggregate SQL        | supported              |
| Prepared-statement reuse               | query-compiler `CompiledQuery` reuse    | supported              |
| Lazy-loaded relation graphs (proxy)    | —                                       | **DNF (anti-pattern)** |
| Identity-map dedup within a request    | —                                       | **DNF (anti-pattern)** |
| Active-record `entity.save()` mutation | —                                       | **DNF (anti-pattern)** |

Anti-pattern rows are reported as `DNF (anti-pattern)` with a link to the
ARCHITECTURE rationale — visible, not hidden. Any supported-in-principle query
we have not wired yet is reported `DNF (not implemented)`.

## Deliverables (sub-issues)

1. Frozen spec: harness layout, result schema (incl. the `DNF` value + reasons), and case matrices.
2. Validation-suite adapter (zmdb entry points as a benchmarked "library") + runner.
3. ORM-suite adapter (server + query set + seed) + k6 runner integration.
4. DNF reporting + comparative results table generator (Markdown/JSON), committed to `benchmarks/RESULTS.md`.
5. Measurement is local, publication is CI. Suites are run by a human on named
   hardware (`yarn bench`, `yarn guardrail --live`) and the resulting JSON is
   committed; CI only verifies what was committed (`yarn verify:bench`) and renders
   it. A shared runner cannot produce a number worth committing, and a regression
   threshold measured on one reports its neighbours rather than our code.

## Constraints

- Reproducible: pinned dataset size, pinned competitor versions, isolated processes.
- Results are deterministic in shape (stable ordering) and diffable.
- ESM-only, Node 26+, TS 7.
- Lives in a top-level `benchmarks/` workspace (not shipped in any published package).

Sub-issues linked below.
