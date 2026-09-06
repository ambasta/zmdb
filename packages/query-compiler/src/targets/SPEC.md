# Non-SQL targets — Spec (epic "Non-SQL targets — MongoDB and Gel")

> Part of `@zmdb/query-compiler`. Spec-only, like `../dialects/`: this directory exists to hold a decision, and the decision is that neither target ships. Read `../../SPEC.md` §5f for the seam this
> measures and `../dialects/SPEC.md` for the SQL matrix, which is a different question.

## 1. The verdict, and the finding that outlasts it

**MongoDB: refused. Gel: refused.** The criterion, stated before the evidence so it cannot be bent to fit it, is the epic's: a target proceeds if it can serve the full read/write surface
`BaseRepository` exposes, plus a documented story for relations and for transactions. Neither reaches it, and the distance is not the same in the two cases.

- **MongoDB** serves eight of the fourteen public repository methods and cannot serve `Serial` primary keys, `aggregate`, or `savepoint`. The first of those means the declaration would have to differ
  per target, which is the one thing this project is for.
- **Gel** could serve more of the surface than MongoDB — EdgeQL is _more_ expressive than SQL at exactly the point zmdb is weakest, which is relations — and is refused for the opposite reason: Gel
  owns its schema. Two "single source of truth" designs cannot both be the source.

The finding worth more than either verdict is what the inventory turned up on the way, and it contradicts the issue, the epic and both docs pages:

> **The seam is already generalised, and it is not `Target<Q>`.** The DTO folders that turn a `WhereDTO` into a query — `compileWhere`, `applyOrderBy`, `applyKeysetFilter`, `applyPagination` — live in
> `@zmdb/schema-core/dto` and drive the builder through two **structural** interfaces, `WhereTarget` and `OrderTarget`, whose methods are `where(col, op, value)` and `orderBy(col, dir)` and which name
> no SQL and no `CompiledQuery`. A non-SQL target that implements those interfaces and returns its own compiled shape is driven by the existing code, unchanged, with no type parameter anywhere and no
> widening of `CompiledQuery`.

So the epic's premise — "if the seam between `Repository` and `CompiledQuery` can be generalised, a document store is reachable" — turns out to be answerable "yes, and it changes nothing", which makes
the seam the wrong thing to have been worried about. §2.1 is what should have been worried about, and §4.3 is what actually decides it.

## 2. What the repository asks the compiler for, method by method

`BaseRepository<T>` has fourteen public methods. None of them hands the compiler a plan object; each one calls builder methods and compiles. The column that matters is the last one — whether the calls
it makes are expressible without SQL vocabulary.

| Method            | What it drives                                                         | SQL in the calls?           |
| ----------------- | ---------------------------------------------------------------------- | --------------------------- |
| `findById`        | `buildKeyWhere` → `compileWhere` → `.limit(1)`                         | no                          |
| `findOne`         | same, via `firstMatching`                                              | no                          |
| `find`            | `compileWhere(selectFrom(table), where)`                               | no                          |
| `findAll`         | `selectFrom(table)`                                                    | no                          |
| `list`            | `applyOrderBy`, `applyKeysetFilter`, `applyPagination`, `compileWhere` | precedence only (§2.1a)     |
| `findByFullText`  | `ftsSelectFrom(table, dialect, { ftsTable }).whereMatch(col, term)`    | yes — dialect and FTS table |
| `findJoined`      | `joinableSelectFrom(...).leftJoin(t, l, r).where(col, op, value)`      | yes — `op` is a free string |
| `aggregate`       | `aggregateSelectFrom`, or a caller callback over the builder           | yes — caller-supplied       |
| `findAllWithMany` | `selectFrom(child).whereIn(fk, chunk)`                                 | no                          |
| `create`          | `insertInto(t).values(row).returning(['*'])`                           | no                          |
| `upsert`          | `.onConflict(target).doUpdate(fields).returning(['*'])`                | no                          |
| `update`          | `updateTable(t).set(row)` + `compileWhere` + `returning(['*'])`        | no                          |
| `delete`          | `deleteFrom(t)` + `compileWhere` + `returning(pk)`                     | no                          |
| `withTransaction` | wraps a `TxConnection`; issues no query itself                         | no                          |

Nine of fourteen are SQL-free at the call site, and the builder state they accumulate — `SelectState` is `{ table, columns?, wheres[], orderBys[], limitN?, offsetN? }` — is a plan already. The issue's
step 1 asks for that plan to be extracted and named `SelectPlan`; it exists, it is internal, and naming it would be the smallest part of the work.

The five that are not SQL-free are not a rough edge. They are the reason the seam does not settle the question.

### 2.1 Three places where SQL is in the plan rather than in the emitter

**(a) The plan's meaning depends on SQL's operator precedence.** An ordinary predicate list is flat: `WhereClause` is `{ col, op, value, connector }` and `predicateList` in `clauses.ts` renders those
entries in order with no implicit parentheses. SQL binds `AND` tighter than `OR`, so a three-predicate list `[{a, AND}, {b, OR}, {c, AND}]` means `a OR (b AND c)`, which is exactly what keyset
pagination wants.

`applyKeysetFilter` is built on that and says so. Its `BranchTarget` wrapper spends a branch's one `OR` on the branch's first predicate and conjoins the rest. `WhereTarget` now has optional
`whereGroup`/`orWhereGroup` methods, and repository filters use them to preserve one filter's Boolean boundary. `compileWhere` does not yet build that grouped tree for the user's own `and`/`or` DTO
arms, so an OR inside the user's where still flattens into the branch's AND.

For a SQL target this is a known, documented under-expressiveness.

For a non-SQL target it is worse than that, because **MongoDB has no precedence to borrow.** `$and` and `$or` are explicit nested arrays, so a Mongo target reading the same flat list has to
_reconstruct_ the grouping SQL got for free — that is, implement SQL's precedence rules in order to read a plan that is supposed to be target-neutral.

A target that does not is not slightly wrong; it returns a different result set. This is the "silently wrong query" the project refuses everywhere else, arriving through the abstraction that was
supposed to prevent it.

Anything that generalises the plan therefore still has to nest the whole predicate tree first — `WhereDTO`'s `and`/`or` arms must round-trip through group nodes, not only repository filters. That is
strictly larger than the target work and belongs to whichever epic owns general predicate grouping.

**(b) The operator vocabulary is closed in the DTO and open in the builder.** `FieldOps` has twelve universal operators (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `like`, `ilike`, `isNull`,
`notNull`) plus the vector-only `l2`, `cosine` and `ip` members, and `and`/`or`/`exists`/`notExists` live on `WhereDTO` itself. That vocabulary is closed and checkable; the twelve universal members
map almost one-to-one onto Mongo (§4.1), while the three extension members are PostgreSQL-only and type-constrained to vector columns.

But the slot it lands in is not closed: `Operator` in the compiler ends with `(string & {})`, `WhereTarget.where` takes `op: string`, `findJoined` takes `{ col, op: string, value }`, and §5a's
extension operators put real SQL — `@>`, `&&`, `ILIKE` — into the same slot on purpose.

So one plan field carries two different things: a closed DTO vocabulary a target can exhaustively translate or explicitly refuse, and arbitrary builder SQL text a target can only refuse. A target
cannot tell them apart from the plan alone, which means the refusal has to happen at the call site or not at all.

**(c) A subquery in the plan is already compiled SQL.** `whereExists(subquery)` accepts `SelectBuilder | { compile(): CompiledQuery }` and stores it as the predicate's `value`; `SubqueryTarget` in
`@zmdb/schema-core` has the same `{ compile(): CompiledQuery }` arm, so `WhereDTO`'s `exists`/`notExists` and every `FieldOps` operator can carry one.

The only thing the plan can do with that value is ask it for SQL text, which `set-ops` then renumbers with a regex over `$n`. A non-SQL target handed one of those has a compiled Postgres string inside
its query document.

### 2.2 And two places SQL leaves the compiler as text

Both are in `@zmdb/repository`, and both would break silently rather than loudly:

- **Read-replica routing reads the SQL.** `isWrite(sql)` in `replicas/index.ts` upper-cases the query text and tests whether it starts with `INSERT`, `UPDATE` or `DELETE`. Given a query object with no
  `text`, this does not fail — it returns `false`, and every write goes to a replica. See `../../../repository/src/replicas/SPEC.md`, which now records that the routing rule is SQL-shaped.
- **Transactions issue raw statements, not compiled queries.** `TxConnection.raw(sql: string)` is how `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT s1` and `RELEASE SAVEPOINT s1` are sent, and
  `transactions/SPEC.md` §3 freezes that statement stream as goldens asserted through a recording connection. A target with no statement stream has nothing to record.

## 3. What generalising costs the SQL path

`ARCHITECTURE.md` §2.6 is the test the epic itself imposes: an abstraction that costs the SQL path anything, in expressiveness or performance, is the wrong abstraction. Three candidate shapes, costed.

`CompiledQuery` is referenced **46 times across 14 source files**:

| Where                                                                              | Refs | Notable                                           |
| ---------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| `query-compiler/src/index.ts`                                                      | 11   | the type, four builders, `QueryCompiler`          |
| `query-compiler/src/set-ops/index.ts`                                              | 5    | consumes text, renumbers placeholders             |
| `query-compiler/src/{clauses,joins,fts,aggregations}` + `migrations/src/runner.ts` | 11   | `frozenQuery`, `MigrationDriver`                  |
| `repository/src/index.ts`                                                          | 5    | `Driver.execute`, `rows`, `aggregate`             |
| `repository/src/transactions/{index,recording-conn}`                               | 6    | `TransactionContext`, `TxConnection`, the goldens |
| `repository/src/replicas/index.ts`                                                 | 2    | `isWrite`'s caller                                |
| `schema-core/src/dto/index.ts`                                                     | 2    | **`SubqueryTarget`**                              |
| `zmdb/src/sql.ts`                                                                  | 1    | the product-facade re-export                      |

### 3.1 A type parameter — `CompiledQuery<Q>` / `Target<Q>` — is the expensive one, and the expense is measured

The last row is the problem. `SubqueryTarget` is a member of `FieldOps`, `FieldOps` is a member of `WhereDTO`, and `WhereDTO<T>` is one of the ten shapes `verify:instantiations` derives per table at
128 and 512 tables. That gate's `derivationPerTable` row has `limit: 640` and `lowerAt: 560`, so the band is roughly twelve percent, and it is a per-table number over ten shapes — "roughly 60
instantiations each", as its own rationale puts it.

Threading `Q` from `Driver` down to `SubqueryTarget` therefore does not stop at the compiler. It adds a type parameter to the DTO family that consumers write by hand, that the AOT reflector reads, and
whose derivation cost is already gated.

Whether it fits in the band is not knowable from inspection; what is knowable is that **the measurement is mandatory before that shape is chosen**, taken with `yarn verify:instantiations` before and
after, and that a budget raise is a decision for a commit message rather than a detail of a refactor.

The readability cost is not measured and is not smaller. `BaseRepository<T>` becomes `BaseRepository<T, Q>`; `Driver`, which `../../../repository/SPEC.md` §1 calls "the one interface third parties
implement", becomes `Driver<Q>`; and every repository method signature in the docs gains a parameter that is `CompiledQuery` in every published example. §2.6 is decisive: the SQL path pays a type
parameter and gains nothing.

### 3.2 A discriminated union is cheaper for the types and worse for the code

`dialect-mongodb.md` already froze this shape — `{ kind: 'sql', text, parameters } | { kind: 'mongo', command }` — and it has the merit of costing no type parameter anywhere, so `WhereDTO` and the
instantiation budget are untouched.

It pays instead at every one of the 46 references that reads `.text`: each becomes a narrowing site, `isWrite` becomes a function with a per-arm body, and every test that asserts on `q.text` — which
is most of the golden suites — needs the arm proved first.

It also makes the union a public shape, so a third-party driver must handle an arm it will never receive.

### 3.3 A structural target costs nothing, and already exists

The third shape is the one §1 describes, and it is not a change to `CompiledQuery` at all:

```ts
// Not a new interface — this is what `@zmdb/schema-core/dto` already drives.
interface WhereTarget {
  where(col: string, op: string, value: unknown): this;
  orWhere(col: string, op: string, value: unknown): this;
  // whereIn / whereNotIn / whereExists / … all optional
}
interface OrderTarget {
  orderBy(col: string, dir: OrderDir): this;
  limit(n: number): this;
  offset(n: number): this;
}
```

A target is a builder factory whose builders implement those, plus a `compile()` returning whatever its own driver executes, plus a driver that accepts it. `CompiledQuery` stays exactly as §1 of
`../../SPEC.md` froze it, because a Mongo driver is not a SQL driver and never receives one. The optional members are how a target declines a capability: `WhereTarget.whereIn` is already optional and
`compileWhere` already checks before calling it.

That is the whole seam, and the reason it is worth writing down even though nothing is being built on it: a future proposal that reaches for a type parameter or a union has to explain why this was not
enough, and the answer is not "the seam" — it is §4.3.

### 3.4 Three coverage justifications remain

`tests/api-coverage/mapping.mjs` carries rationales that a generalised seam could have falsified. On the structural shape they hold, and the wording is load-bearing:

- **`NO_PLUGIN_LAYER`** — "the compiler is a pure function from a builder to a frozen CompiledQuery, and a hook that can rewrite SQL after the fact is a hook that can invalidate every guarantee". A
  target _replaces_ the emitter before compilation; it does not intercept output. The distinction is the one the rationale draws, so it survives — but only for the structural shape. An open
  `Target<Q>` extension point that third parties implement would be a plugin layer by another name, and the row would have to come out.
- **`NO_DIALECT_ONLY_SYNTAX`** — zmdb exposes a portable semantic operation only when each shipped dialect has a safe spelling or an explicit refusal; engine-only syntax remains raw SQL. A target is
  not a dialect, so this epic does not change that boundary.
- **`NO_MIKRO_KYSELY`** — "zmdb ships its own compiler, and its escape hatch is that a driver takes raw SQL". Unchanged, and the escape hatch is exactly `TxConnection.raw` from §2.2.

## 4. MongoDB, per method

The matrix required by the epic's reporting constraint — a target that supports 60% of the repository surface must say which 60%, per method" — for both targets at once, because a reader choosing
between them wants one table. The Gel column is the _query_ half only; that target is refused one level up, on schema ownership (§5.1), so a cell there is "could EdgeQL express this", not "is it
supported".

| Method            | MongoDB                                                                                 | Gel (query half)                                                                |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `findById`        | yes — `findOne({ _id })`, but see the key problem in §4.3                               | yes                                                                             |
| `findOne`         | yes                                                                                     | yes                                                                             |
| `find`            | yes — the filter maps (§4.1)                                                            | yes                                                                             |
| `findAll`         | yes                                                                                     | yes                                                                             |
| `list`            | translated — keyset needs `$or` nesting rebuilt (§2.1a)                                 | translated — same reason                                                        |
| `findByFullText`  | **refused** — one text index per collection; `column` ignored                           | decide — FTS is declared on the schema, so it lands on the half that is refused |
| `findJoined`      | translated for `inner`/`left` via `$lookup` + `$unwind`; **refused** for `right`        | yes — links, natively nested                                                    |
| `aggregate`       | **refused** — the callback form hands a SQL builder to application code (§4.3)          | **refused** — same reason, and it is not about the target                       |
| `findAllWithMany` | yes — `find({ fk: { $in: […] } })`, no `$lookup` (§4.2)                                 | yes — a shape, one query                                                        |
| `create`          | yes — `insertOne`, but a `Serial` key cannot round-trip (§4.3)                          | yes                                                                             |
| `upsert`          | translated — filter-matched `upsert: true`, needs a unique index on the conflict target | yes — `unless conflict on`                                                      |
| `update`          | yes — `findOneAndUpdate`, `returnDocument: 'after'` for `RETURNING`                     | yes                                                                             |
| `delete`          | yes — `deleteOne`, `deletedCount` for the boolean                                       | yes                                                                             |
| `withTransaction` | **refused** — see `savepoint` below                                                     | not assessed (§5.1)                                                             |

And the machinery around the fourteen, which the issue's step 2 does not list and which decides the outcome as much as the methods do:

| Concern                        | MongoDB                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `transaction(cb)`              | replica set or sharded cluster only; a single-node install cannot               |
| `tx.savepoint(fn)`             | **refused** — no savepoints, no nested transactions (§4.3)                      |
| Migrations                     | **refused** — no DDL; indexes and `$jsonSchema` are a different artifact (§4.4) |
| `withReplicas`                 | **refused** — routes on the SQL prefix (§2.2)                                   |
| `Driver.stream`                | yes, and better than SQL — a Mongo cursor is native                             |
| `toJsonSchema` + `$jsonSchema` | yes today, with one correction (§4.6)                                           |

### 4.1 The filter half is genuinely close

Every one of the twelve universal `FieldOps` operators has a Mongo spelling, and eight are direct. The three vector-only operators are PostgreSQL extension operations and a Mongo target must refuse
them:

| `FieldOps` | Mongo                          | Direct? |
| ---------- | ------------------------------ | ------- |
| `eq`       | `{ $eq: v }`                   | yes     |
| `ne`       | `{ $ne: v }`                   | yes     |
| `lt`       | `{ $lt: v }`                   | yes     |
| `lte`      | `{ $lte: v }`                  | yes     |
| `gt`       | `{ $gt: v }`                   | yes     |
| `gte`      | `{ $gte: v }`                  | yes     |
| `in`       | `{ $in: [...] }`               | yes     |
| `nin`      | `{ $nin: [...] }`              | yes     |
| `isNull`   | `{ $eq: null }`                | narrows |
| `notNull`  | `{ $ne: null }`                | narrows |
| `like`     | `{ $regex: … }`                | **no**  |
| `ilike`    | `{ $regex: …, $options: 'i' }` | **no**  |

The two that are not direct are the interesting ones, because passing them through is the failure mode. A `LIKE` pattern and a regex are different languages: `%` and `_` are the wildcards in one and
literals in the other, while `.`, `*`, `+`, `?`, `(`, `[`, `\` and `^` are literals in one and metacharacters in the other.

So `like: 'a.b%'`, which in SQL matches `a.b` followed by anything, becomes in a naive mapping a regex where `.` matches any character — a wider result set, silently. A target must translate: escape
every regex metacharacter, then map `%` to `.*` and `_` to `.`, then anchor with `^` and `$` unless the pattern begins or ends with `%`.

`isNull` narrows because Mongo does not distinguish "the field is null" from "the field is absent", and `{ $eq: null }` matches both. That is a real semantic difference, not a spelling one, and it is
the kind of thing the per-method page has to say out loud.

There is also a performance divergence worth one line on the page: an unanchored `$regex` cannot use an index, so `like: '%term%'` degrades to a collection scan where Postgres would at least consider
a trigram index.

### 4.2 Both the issue and the docs page are wrong about `populate`

The issue says "`populate` becomes `$lookup` with real limitations". The page says "`populate` maps to `$lookup`". Neither is true of this codebase, and the truth is better news.

zmdb's populate has never been a join. `childrenByParent` runs `selectFrom(childTable).whereIn(childFk, chunk)` — a second query, chunked, grouped in JavaScript by the foreign key, with
`attachRelations` copying rows rather than mutating them. On Mongo that is `find({ fk: { $in: [...] } })`. No aggregation pipeline, no `$lookup`, none of `$lookup`'s limitations, and no 16MB pipeline
concern.

One thing does change: `DIALECT_PARAM_LIMITS[dialect]` is the total SQL-dialect chunk-size table, and it exists because SQL placeholders are finite. Mongo has no placeholder limit; its limit is the
16MB BSON command size, so a Mongo target would set a chunk size for a different reason and by a different calculation. That belongs in a target trait, not in `DIALECT_PARAM_LIMITS`.

`Driver.stream` is the other place Mongo would be _better_: a Mongo cursor is native, where §1a's streaming has to be negotiated per SQL driver.

### 4.3 The three that end it

**A `Serial` primary key cannot exist.** `SqlType` includes `serial`, and the repository's `create()` returns `Entity<T>` — meaning `id: number & Serial` is a promise that a number comes back. Mongo
has no server-side sequence; `_id` is an `ObjectId`, and `dialect-mongodb.md` already names the consequence ("`_id` as an `ObjectId` does not satisfy an `id: number` field, and the validator will
correctly say so"). The available workarounds are all worse than refusing:

- A client-generated integer is a counter in application code, which is what a database is for.
- A `findAndModify` counter collection is a write per insert and a documented Mongo anti-pattern.
- Declaring `id: string` instead is **undeclarable today**: `SqlType` has no `uuid` member (see `../dialects/SPEC.md` §3.6, which reaches the same wall from the SQL Server side) and no ObjectId
  member, so there is no tag to spell it with.

Which leaves the only practical option: the _declaration_ differs per target. That contradicts the premise the whole project rests on, and it fails the epic's own constraint that the target must offer
"the same validation and typing as the SQL path". Every schema the scaffold generates has a `Serial` primary key, so this is not an edge case — it is the default case.

**`aggregate` has no target-neutral spelling.** Its second form takes a callback, `(agg: RepositoryAggregateBuilder) => { compile(): CompiledQuery } | void`, hands it a builder wrapped in a `Proxy`
that re-wraps every returned builder, and accepts anything with a `compile()`. So application code — not library code — holds a SQL builder and names SQL functions on it.

There is no version of that method whose caller is target-agnostic, which means an application that calls `aggregate` is SQL-specific by construction, however good the seam underneath is. The epic's
own definition of done asks for "aggregation for the operations the repository exposes"; this is the operation it exposes.

**`savepoint` cannot be implemented, and it is frozen public API.** `TransactionContext.savepoint(fn)` is in `../../../repository/src/transactions/SPEC.md` §2, its statement ordering is frozen as
goldens in §3, and it is issued as `raw('SAVEPOINT s1')`. MongoDB has no savepoints and no nested transactions, and its transactions require a replica set or a sharded cluster at all. A target that
throws on `savepoint` does not implement `TransactionContext`, and "a documented story for transactions" is half the criterion.

### 4.4 Also refused, individually

- **`findByFullText(column, term)`** — Mongo allows **one** text index per collection and `$text` searches that index, not a named field. The `column` argument cannot be honoured, so the naive mapping
  ignores an argument the caller passed, which is the silent-wrongness pattern again. Atlas Search is a different product with a different query shape and is not portable to a local deployment.
  `ftsTable`, the SQLite companion-table option, means nothing here.
- **`findJoined`** — `$lookup` inside an aggregation, with `$unwind` to flatten to the `JoinRow` shape the signature promises. Expressible, at a cost, for `inner` and `left`. Not for `right`, which
  the aggregate builder's `joinRelation` offers: `$lookup` is a left outer join and there is no reversed form.
- **Migrations** — there is no DDL. Index creation and `$jsonSchema` validators are real artifacts and a Mongo story could be built from them, but `Migration` is
  `{ version, name, up: string, down: string }` and `MigrationConnection` executes strings. That is a different artifact, not a dialect of this one, and `../../../migrations/src/SPEC.md` §3 and §4 are
  frozen around the string.
- **`withReplicas`** — §2.2. Routing by `INSERT|UPDATE|DELETE` prefix has no input.

### 4.5 The tally

Eight of fourteen methods served as written — `findById`, `findOne`, `find`, `findAll`, `findAllWithMany`, `create`, `update`, `delete`. Three served with a translation that has to be got right or the
result set is silently different: `list`, `upsert`, and `findJoined` for two of its three join kinds. Three refused: `findByFullText`, `aggregate`, `withTransaction`. Then zero of two transaction
primitives, no migrations, no replica routing, and a primary key that cannot be declared.

Against the criterion in §1 that is a refusal — and it would have been a refusal even if the seam had cost nothing at all, which is the part worth remembering, because the seam is what the epic was
about.

### 4.6 What is already true, and should be the page's headline

`toJsonSchema` plus `createCollection` gives real schema enforcement in Mongo derived from a zmdb declaration, with no compiler work whatever. That is on the page already and is buried under the
feature gap. It also does not work as written:

`toJsonSchema` emits JSON Schema `format` — `format: 'date-time'` for a `timestamp` column and `format: 'int64'` for a `bigint` — and Mongo's `$jsonSchema` implements a subset that does not include
`format` and **rejects unknown keywords** rather than ignoring them. Since a `timestamp` column is in almost every schema, the page's example fails for almost every reader.

The page must either strip unsupported keywords in the example or say plainly that it needs stripping; `dialect-mongodb.md` line 32's claim that the emitter "produces a document Mongo accepts" is the
specific sentence that is wrong.

## 5. Gel, per method

### 5.1 The decision is about schema ownership, and the page already made it

`dialect-gel.md` states the argument better than a matrix would:

> zmdb's whole design is that a TypeScript schema object is the single source of truth from which the DDL, the DTOs, the validators and the OpenAPI document are derived. Gel owns its schema and
> generates a client from it. Both are "one source of truth" designs, and they cannot both be the source.

The epic's definition of done requires, for Gel, "the equivalent for EdgeQL, **including its schema-definition model**". There are exactly two ways to satisfy that, and both are a different product:

1. **zmdb generates `.gel` schema files** from schema objects, and Gel's migration tooling runs downstream. zmdb stays the source; the user now has two migration systems, and zmdb's `migrate` command
   becomes a code generator whose output another tool applies.
2. **zmdb reads Gel's schema** and derives TypeScript from it. Gel is the source; zmdb becomes a client, `Table<'users'>` declarations stop being authoritative, and the AOT validator is validating
   against a type it did not derive from the declaration the user wrote.

Option 2 is the clearer of the two and is what the page recommends. It is also not this library. **Refused**, on the schema half rather than the query half.

### 5.2 The query half would have gone well, which is why the refusal needs stating carefully

Refusing Gel is not a claim that Gel is a poor fit for the query surface. EdgeQL is _more_ expressive than SQL where zmdb is weakest:

| Repository concern         | SQL today                                                           | EdgeQL                               |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `populate` (to-many)       | second query, chunked `IN`, grouped in JS                           | a shape — one query, natively nested |
| `Populated<T, K>`          | assembled by `attachRelations`                                      | the shape _is_ the result type       |
| `findJoined`               | flat rows typed `Base & Joined`, so a column on both sides collides | links, nested, no row multiplication |
| Predicate grouping (§2.1a) | borrowed from SQL precedence                                        | explicit, so nothing to borrow       |
| `ManyToMany`               | throws — `via` cannot be guessed                                    | a multi link; nothing to guess       |

The last two rows are the ones to keep in mind if this is ever reopened: a Gel target would have to solve §2.1a's grouping properly, because EdgeQL, like Mongo, has no SQL precedence to inherit. And
`ManyToMany`, which `../../../repository/src/typed-populate/SPEC.md` refuses outright on the SQL path, is expressible.

Set semantics are the one place EdgeQL is _harder_: expressions return sets and there is no SQL `NULL`, so `isNull` and `notNull` — and the whole of `../../SPEC.md` §5c — need a translation decision
rather than a spelling.

### 5.3 What proceeds instead: nothing new, and that is a real answer

Gel exposes a read-mostly Postgres-protocol endpoint, so `createQueryCompiler(postgres)` against it already works today, with Gel's own table naming, links surfaced as columns and link tables, and
limited writes. That is not a workaround to apologise for; it is a supported use — reporting and analytics against a Gel database, treated as
[raw SQL against a foreign schema](../../../../docs-site/content/raw-sql.md). It costs zero new code, and it is currently the third section of a page whose first two are about a missing feature.

## 6. What the two pages say instead

Both stay `status: 'todo'` in `docs-site/pages.mjs`, which the epic's definition of done explicitly allows ("or stay `todo` with a sharper, evidence-based note"). The notes are replaced, because both
current notes name the wrong blocker:

| Page              | Note                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect-mongodb` | refused with reasons: a `Serial` primary key has no Mongo equivalent, `aggregate` hands SQL to application code, and `savepoint` has none |
| `dialect-gel`     | refused with reasons: Gel owns its schema, so zmdb would be a client rather than the source; the SQL endpoint is the supported path       |

The docs sub-issue (#517) owns the prose. What it must change, so that it has no research left to do:

1. **`dialect-mongodb.md` line 18 is wrong.** "`CompiledQuery` being a string is the concrete blocker" — it is not. §3.3 shows the seam moves without touching `CompiledQuery` at all. Replace with the
   three blockers from §4.3.
2. **Line 65's "What it would take" is wrong twice.** The discriminated union is one of three shapes and the most expensive but one (§3.2), and "`populate` maps to `$lookup`" is false (§4.2). Say
   instead that populate maps to `$in` and needs no pipeline.
3. **Line 32 is factually wrong** about `$jsonSchema` accepting the emitter's output (§4.6). Keep the recipe — it is the best thing on the page — and add what has to be stripped.
4. **Add the per-method matrix** from §4, all fourteen rows, because explicit reporting matters more than completeness in the epic's architecture constraints asks for exactly that.
5. **Add the `LIKE`-to-regex translation** and the null/absent conflation (§4.1). A reader evaluating Mongo needs to know the filter half is close but not free.
6. **`dialect-gel.md` keeps its argument** — it is correct and better than a rewrite — and gains §5.2's table plus the promotion of the SQL endpoint from third section to the answer.
7. **Both pages keep their "using zmdb with X today" sections.** Five rows in `docs-site/coverage/mapping.mjs` point at these two pages (`usage-with-mongo`, `techniques/mongo`, `recipes/mongodb`,
   `get-started-gel`, `guides/gel-ext-auth`), so a reader arrives here from another project's documentation asking how to do a thing, not whether we support it.
8. **Neither page says "unsupported" without a reason.** That is step 6 of the issue and the one thing both pages already do well.

## 7. What would reopen this

Recorded so that a future proposal is measured rather than re-argued. MongoDB becomes reachable when all three of these are true, and not before:

1. `SqlType` gains a member that can spell an externally-generated key — a `uuid`, or an opaque string key — so a schema's primary key does not have to be `Serial`. `../dialects/SPEC.md` §3.6 wants
   the same member for a different reason, so this is not a Mongo-specific ask.
2. `aggregate` grows a declarative form that is complete enough that the callback form is not the documented path. `AggregateSpec` is already that form; the callback is the escape hatch, and the
   question is whether the spec form covers what people actually run.
3. Either `savepoint` leaves the public transaction surface, or a target is allowed to refuse one named capability and the docs say which targets do.

And two rules for any target that does arrive:

- It arrives as a **structural** target (§3.3): builders implementing `WhereTarget` and `OrderTarget`, its own `compile()`, its own driver. Not a type parameter on `CompiledQuery`, not a union arm,
  and not an interface third parties implement — §3.4's `NO_PLUGIN_LAYER` is the reason for the last one.
- It fixes §2.1a first. A flat predicate list whose meaning is SQL's precedence cannot be handed to a target that has no precedence, and the fix is a nested predicate tree, which is a change to the
  SQL path and an improvement to it.

## 8. Non-goals (rejected)

- **`Target<Q>` as specified in the issue.** §3.1 — the parameter reaches `WhereDTO` through `SubqueryTarget` and lands inside a measured budget, for no gain on the SQL path (ARCHITECTURE §2.6).
- **`CompiledQuery` as a discriminated union.** §3.2 — 46 narrowing sites and a public arm that third-party SQL drivers must handle and never receive.
- **Naming `SelectPlan`/`InsertPlan`/`UpdatePlan`/`DeletePlan` as public types.** §2 — `SelectState` is already the plan; publishing it freezes an internal shape that §2.1a still has to change.
- **A partial MongoDB target behind a flag.** §4.5 — eight of fourteen methods with no transaction story is the "subset that will be reported as broken" the issue was written to avoid.
- **A counter collection, or client-generated integer keys, to fake `Serial`.** §4.3.
- **Requiring a different declaration per target.** §4.3 — it contradicts the one premise the library has.
- **Mapping `like` straight onto `$regex`.** §4.1 — a wider result set, silently, which is the exact failure this project refuses.
- **Honouring `findByFullText`'s `column` argument on Mongo by ignoring it.** §4.4.
- **Atlas Search as the full-text story.** §4.4 — not portable to a local deployment.
- **`$lookup` for `populate`.** §4.2 — the batched `$in` is both simpler and what the code already does.
- **zmdb generating `.gel` schema files.** §5.1 — two migration systems, and zmdb's `migrate` becomes a code generator.
- **zmdb reading Gel's schema to derive TypeScript.** §5.1 — the more cleaner design, and a different product.
- **Flipping either page to `supported`.** §6 — refusal with reasons is the outcome, and the pages' status has to say so.
- **A plugin layer that rewrites a compiled query.** §3.4 — the seam chooses an emitter; it does not intercept output.
