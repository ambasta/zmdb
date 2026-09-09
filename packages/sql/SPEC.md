# `@zmdb/sql` — schema-bound query compilation (#774)

The root compiler owns SELECT, joins, aggregation, full-text predicates and CRUD. Each query starts with the canonical `TaggedSchema<T>` value; property, operand, create/update and projection types
derive from `@zmdb/schema/derive`. A caller cannot select a table string and separately supply an unrelated declaration generic.

```ts
const qb = createQueryCompiler(postgresDialect);
const query = qb
  .selectFrom(UserSchema, 'u')
  .leftJoin(PostSchema, 'p', [{ leftCol: 'u.id', rightCol: 'p.userId' }])
  .select(['u.id', { column: 'p.title', alias: 'title' }])
  .where('u.active', '=', true);
```

Column references use application properties. Schema physical table and column names determine SQL identifiers. Qualified selections retain their qualified result key through an explicit SQL alias;
`{ column, alias }` chooses a result key. Duplicate table and result aliases are compile errors. Left joins make the target's projected values nullable; right joins make the preceding scope nullable.
The final SELECT context qualifies schema-owned root references whenever ordinary or generated FTS joins are present, including references supplied before a later join. Output aliases retain their own
ownership; write column syntax remains unqualified. Fluent operations return immutable builders, and `compile()` returns an inert frozen query with parameters in SQL order.

`insertInto(schema).values(...)` takes `CreateDTO<T>`; UPDATE and conflict updates take property-compatible values or existing column expressions, excluding generated identities. Conflict keys and
RETURNING selections use application properties. RETURNING derives its result projection.

An actually dynamic or already mapped physical SQL caller uses `trustedTable(physicalName, { ftsTable? })`. The same compiler accepts that explicit target and returns `UnknownRow`; this path has no
caller-selected declaration generic. It does not infer a schema from SQL text. `expr(sql, alias)` remains the explicit raw expression boundary and its result is unknown.

Joins, aggregate methods, grouped predicates and `whereMatch` compose on the same SELECT builder. The specialized `/joins`, `/aggregations` and `/fts` owners and factories are removed. Plain queries
allocate no join, aggregate or FTS state; immutable schema column/projection metadata is cached once per schema value. Type derivation emits no runtime validation/reflection framework.

The package exports `.`, `./comments`, `./set-ops`, and `./schema-objects`. Dialect protocols remain public from the root. Public declarations depend on `@zmdb/schema`; the compiler adds no runtime
schema import. Introspection and migration execution belong to `@zmdb/migrations`, and outbox composition belongs to `@zmdb/orm`.

This issue adds no CTE, window function, aggregate expression language or query-effect contract. Existing pagination and structural subquery compilation semantics remain in their owning contracts.
