# Query Builder Full-Text Search — Frozen Spec (Issue #94)

> Status: **FROZEN** for TDD. Implementation (#95–#97) must satisfy this spec.
> Part of `@zmdb/query-compiler`. Targets: Node 26+, ESM, TS 7.
> Motivation: zmdb DNFs the /search-* routes of drizzle-benchmarks. This freezes
> the full-text-search predicate builder + the honest per-dialect DNF map.

## 1. Grammar

```ts
qb.selectFrom(table).whereMatch(column, term).compile();
```

`whereMatch` adds a full-text-search predicate. Composes with existing where/
limit/offset. Immutable, parameterized.

## 2. Per-dialect compilation (frozen)

| dialect  | whereMatch(col, term) →                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------- |
| postgres | `to_tsvector('english', "col") @@ to_tsquery('english', $n)`                                         |
| mysql    | `MATCH("col") AGAINST(? IN NATURAL LANGUAGE MODE)`                                                   |
| sqlite   | **DNF** — no built-in FTS on an arbitrary column (FTS5 needs a virtual table); documented, not faked |

The term is always a bound parameter (`$n` / `?`).

## 3. Golden SQL (postgres)

```
selectFrom('customers').whereMatch('company_name','ltd')
=> SELECT * FROM "customers"
   WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)
   params: ['ltd']
```

## 4. DNF honesty

`whereMatch` on the `sqlite` dialect throws a documented
`UnsupportedFeatureError('full-text search', 'sqlite')` — surfaced as an honest
DNF, never a silently-wrong query.

## 5. Non-goals (rejected)

- No ranking/highlighting in this epic. No implicit FTS index management.
