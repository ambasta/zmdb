# [EPIC] Query builder: aggregations (GROUP BY + computed columns)

## Motivation (from real benchmarks)

zmdb returns **DNF (HTTP 501)** on the aggregate routes of the drizzle-benchmarks suite because `@zmdb/query-compiler` has **no aggregate / GROUP BY / computed- column builder**
([benchmarks/RESULTS.md](../../benchmarks/RESULTS.md)):

| route                  | why DNF                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `/orders-with-details` | `count()`, `sum()`, `sum(qty*price)` grouped by order, paginated |
| `/order-with-details`  | same aggregates for a single order                               |

## Goal

Add aggregation support to `@zmdb/query-compiler`: `select()` with computed expressions (`count`, `sum`, `avg`, `min`, `max`, arithmetic), `groupBy(...)`, `having(...)`, and result typing for computed
columns. Compose with JOINs (depends on the JOIN epic) and existing where/order/limit/offset.

## Definition of Done

Sub-issues collectively deliver:

1. Frozen spec: aggregate/select-expression grammar + golden SQL + result typing.
2. Aggregate functions (count/sum/avg/min/max) + arithmetic expressions.
3. `groupBy` + `having` compilation.
4. Repository integration returning typed computed columns + E2E on real Postgres.
5. Re-run the two DNF aggregate routes; confirm 200 + correct aggregates + record throughput vs drizzle/kysely.

## Constraints

- Pure string compilation, parameterized, dialect-aware, deterministic.
- ESM-only, Node 26+, TS 7.
- Depends on the JOINs epic for the join+aggregate routes.

Labels: epic, perf.
