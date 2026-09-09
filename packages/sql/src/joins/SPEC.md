# Query Builder JOINs — Frozen Spec (Issue #84)

> Status: **FROZEN** for TDD. Implementation (#85–#88) must satisfy this spec. Part of `@zmdb/sql`. Targets: Node 26+, ESM, TS 7. Motivation: zmdb DNFs the join routes of drizzle-benchmarks. This
> freezes the join builder grammar + golden SQL.

## 1. Grammar

```ts
qb.selectFrom(UserSchema, 'u')
  .leftJoin(PostSchema, 'p', [{ leftCol: 'u.id', rightCol: 'p.userId' }], onPredicates)
  .select(['u.id', { column: 'p.title', alias: 'title' }])
  .where('u.active', '=', true)
  .compile();
```

The canonical SELECT builder owns `innerJoin`, `leftJoin` and `rightJoin`. All use one signature: declared target schema, unique alias, ordered non-empty column pairs, and optional target predicates.
Composite pairs are conjoined in the ON clause. ON parameters precede WHERE parameters. Column pairs use declared properties and must have compatible values.

Physical schema names determine rendering. A qualified selected property is aliased back to its complete qualified result key. Explicit projection aliases must be unique. A left join makes target
values nullable; a right join makes the preceding scope nullable. Builders remain immutable and compilation performs no I/O.

Dynamic physical targets use `trustedTable(name)` with the same builder and return `UnknownRow`. Bare table strings and the specialized join factory are removed by #774.

## 3. Identifier quoting rule

A qualified reference `x.y` quotes each part: `"x"."y"`. An aliased table `t as al` compiles to `"t" AS "al"`. Dialect: pg/sqlite double quotes, mysql backticks (same as existing dialect strategy).

## 4. Non-goals (rejected)

- No lazy proxy relations. No identity-map dedup. Joins are explicit compiled SQL.
