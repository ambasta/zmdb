# [EPIC] Query builder: JOINs

## Motivation (from real benchmarks)

The drizzle-benchmarks HTTP+k6 run
([benchmarks/RESULTS.md](../../benchmarks/RESULTS.md)) shows zmdb returns **DNF
(HTTP 501)** on these routes because `@zmdb/query-compiler` has **no JOIN
builder**:

| route                           | why DNF                               |
| ------------------------------- | ------------------------------------- |
| `/employee-with-recipient`      | self-join on `employees.recipient_id` |
| `/product-with-supplier`        | join products → suppliers             |
| `/order-with-details` (partial) | join orders → order_details           |

These are part of the **57.8% of replay traffic zmdb cannot serve**. Relations
`populate` covers the _explicit two-query_ pattern, but there is no general JOIN
in the query builder.

## Goal

Add a JOIN builder to `@zmdb/query-compiler`: `innerJoin` / `leftJoin` /
`rightJoin` with `on(...)` predicates, dialect-correct SQL, parameterized,
composable with existing where/order/limit. Preserve zero-overhead compilation
(pure string building, no runtime type resolution).

## Non-goals / anti-patterns (rejected)

- No lazy proxy-loaded relations. Joins are explicit, compiled SQL.
- No identity-map result dedup.

## Definition of Done

Sub-issues collectively deliver:

1. Frozen spec: join grammar + golden SQL per dialect + join-alias handling.
2. `innerJoin`/`leftJoin`/`rightJoin` + `on()` compilation.
3. Self-join + multi-join + aliasing support.
4. Repository integration (a typed `join`/populated result) + E2E on real Postgres.
5. Re-run the drizzle-benchmarks routes that were DNF; confirm they now serve
   (200, correct rows) and record throughput.

## Constraints

- Parameterized, dialect-aware (pg/mysql/sqlite), deterministic output.
- ESM-only, Node 26+, TS 7.

Labels: epic, perf, parity:mikro-orm.
