# [EPIC] Query builder: full-text search predicates

## Motivation (from real benchmarks)

zmdb returns **DNF (HTTP 501)** on the search routes of drizzle-benchmarks because `@zmdb/query-compiler` has **no full-text-search predicate builder**
([benchmarks/RESULTS.md](../../benchmarks/RESULTS.md)):

| route              | why DNF                                         |
| ------------------ | ----------------------------------------------- |
| `/search-customer` | `to_tsvector(company_name) @@ to_tsquery(term)` |
| `/search-product`  | `to_tsvector(name) @@ to_tsquery(term)`         |

(Note: the k6 profile filters `/search*`, so these do not affect the throughput numbers — but they are real, individually-listed feature gaps.)

## Goal

Add a dialect-aware full-text-search predicate builder to `@zmdb/query-compiler`: `whereMatch(column, term)` compiling to Postgres `to_tsvector(col) @@ to_tsquery($1)` (and dialect equivalents where
they exist; `DNF`/documented where a dialect has no FTS). Parameterized, composable.

## Definition of Done

Sub-issues collectively deliver:

1. Frozen spec: FTS predicate grammar + golden SQL per dialect + the honest per-dialect DNF map (e.g. sqlite FTS5 vs none).
2. Postgres `to_tsvector/@@/to_tsquery` compilation.
3. Repository integration + E2E on real Postgres against the Northwind data.
4. Re-run `/search-customer` and `/search-product`; confirm they serve (200, correct rows) instead of 501.

## Constraints

- Parameterized, deterministic; dialect FTS differences stated honestly.
- ESM-only, Node 26+, TS 7.

Labels: epic, parity:mikro-orm.
