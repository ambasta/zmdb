# Query Builder Full-Text Search — Frozen Spec (Issue #94)

> Status: **FROZEN** for TDD. Implementation (#95–#97) must satisfy this spec. Part of `@zmdb/query-compiler`. Targets: Node 26+, ESM, TS 7. Motivation: zmdb DNFs the /search-* routes of
> drizzle-benchmarks. This freezes the full-text-search predicate builder + the explicit per-dialect DNF map.

## 1. Grammar

```ts
qb.selectFrom(table).whereMatch(column, term).compile();
```

`whereMatch` adds a full-text-search predicate. Composes with existing where/ limit/offset. Immutable, parameterized.

## 2. Per-dialect compilation (frozen)

| dialect  | whereMatch(col, term) →                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| postgres | `to_tsvector('english', "col") @@ to_tsquery('english', $n)`                                                                                                              |
| mysql    | `MATCH("col") AGAINST(? IN NATURAL LANGUAGE MODE)`                                                                                                                        |
| sqlite   | `INNER JOIN "table_fts" ON "table"."rowid" = "table_fts"."rowid" WHERE "table_fts"."col" MATCH ?` (if `ftsTable` declared); plain column throws `UnsupportedFeatureError` |

The term is always a bound parameter (`$n` / `?`).

## 3. Golden SQL (postgres & sqlite FTS5)

```
selectFrom('customers').whereMatch('company_name','ltd')
=> SELECT * FROM "customers"
   WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)
   params: ['ltd']

ftsSelectFrom('customers', 'sqlite', { ftsTable: 'customers_fts' }).whereMatch('company_name','ltd')
=> SELECT * FROM "customers"
   INNER JOIN "customers_fts" ON "customers"."rowid" = "customers_fts"."rowid"
   WHERE "customers_fts"."company_name" MATCH ?
   params: ['"ltd"']
```

## 4. Explicit DNF behavior and the SQLite contract

`whereMatch` on the `sqlite` dialect on a plain column (without an explicitly declared `ftsTable` in schema or query options) throws a documented
`UnsupportedFeatureError('full-text search', 'sqlite')` — surfaced as an explicit DNF, never a silently-wrong query. When an FTS5 virtual table is declared (`ftsTable`), `whereMatch` compiles an FTS5
virtual table JOIN with term escaping.

## 5. Non-goals (rejected)

- No ranking/highlighting in this epic. No implicit FTS index management.
