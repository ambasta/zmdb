> **ToDo / not planned.** No MongoDB target ships. The feasibility study refused it because the current declaration and repository contracts cannot be implemented faithfully: a `Serial` key has no
> MongoDB equivalent, `aggregate` hands SQL to application code, and the public transaction surface requires savepoints.

## Repository method matrix

This is a feasibility record, not a support table. **None of these methods has a MongoDB implementation.** “Expressible” means the accepted target study found a faithful MongoDB operation for that
method; it does not mean zmdb executes it.

| Repository method | MongoDB feasibility                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `findById`        | expressible as `findOne({ _id })`, but the current `Serial` key cannot round-trip                      |
| `findOne`         | expressible                                                                                            |
| `find`            | expressible; the filter differences below still apply                                                  |
| `findAll`         | expressible                                                                                            |
| `list`            | needs translation: keyset branches require explicit `$and`/`$or` nesting                               |
| `findByFullText`  | refused: MongoDB searches one text index per collection, so the `column` argument cannot be honoured   |
| `findJoined`      | translatable for the current `inner`/`left` forms with `$lookup` and `$unwind`                         |
| `aggregate`       | refused: the callback form gives application code a SQL aggregate builder                              |
| `findAllWithMany` | expressible as a second `find({ fk: { $in: [...] } })`; this is not `$lookup`                          |
| `create`          | expressible as `insertOne`, but the current `Serial` key cannot round-trip                             |
| `upsert`          | needs translation to a filter-matched upsert and a unique index on the conflict target                 |
| `update`          | expressible as `findOneAndUpdate` with the updated document returned                                   |
| `delete`          | expressible as `deleteOne`, with `deletedCount` supplying the boolean result                           |
| `withTransaction` | refused: MongoDB has no savepoints, while zmdb's public `TransactionContext` requires `savepoint(...)` |

Eight methods are expressible as written, three need a target-specific translation, and three are refused. That partial surface is deliberately not reported as support.

## Why the target was refused

The compiler output shape was not the blocker. The DTO fold is already target-neutral: `compileWhere`, `applyOrderBy`, `applyKeysetFilter` and `applyPagination` drive structural `WhereTarget` and
`OrderTarget` interfaces that mention neither SQL nor `CompiledQuery`. A future target could provide its own builders, compiled command shape and driver without widening the SQL path.

The target still fails the criterion of covering the full read/write surface, relations and transactions:

- **Keys:** scaffolded schemas use a numeric `Serial` primary key. MongoDB has no server-side sequence, and its normal `_id` is an `ObjectId`, so `create(): Entity<T>` could not return the declared
  key truthfully.
- **Aggregation:** `aggregate(callback)` passes a `RepositoryAggregateBuilder` to application code. That callback is SQL-specific by construction, not a target-neutral plan a MongoDB emitter can
  translate.
- **Transactions:** MongoDB transactions require a replica set or sharded cluster and do not provide savepoints or nested transactions. zmdb exposes `savepoint` as part of `TransactionContext`.

All six current `Dialect` values are SQL dialects. MongoDB is not one: it changes the command representation, schema model and transaction capabilities rather than only how SQL is written. That
requires a separate structural target, not another branch in SQL quoting or placeholder code.

## Filters are close, not identical

Most `WhereDTO` operators have a direct command-document spelling:

| `FieldOps`                      | MongoDB assessment                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `eq`, `ne`, `lt`, `lte`         | direct `$eq`, `$ne`, `$lt`, `$lte`                                                     |
| `gt`, `gte`, `in`, `nin`        | direct `$gt`, `$gte`, `$in`, `$nin`                                                    |
| `like`, `ilike`                 | must translate SQL wildcards into an escaped, anchored regular expression              |
| `isNull`                        | `$eq: null` also matches an absent field, unlike SQL `IS NULL`                         |
| `notNull`                       | maps to `$ne: null`, with MongoDB's field-existence semantics                          |
| `l2`, `cosine`, `ip`            | refused: these are PostgreSQL vector extension operators, not universal DTO operations |
| `exists`, `notExists`, grouping | require a target-native nested predicate tree rather than SQL's implicit precedence    |

A `LIKE` pattern cannot be passed to `$regex` verbatim. SQL uses `%` and `_` as wildcards, while regular expressions give characters such as `.`, `*`, `+`, `?`, `(`, `[` and `\` special meaning. A
faithful translation first escapes regular-expression metacharacters, then maps `%` to `.*` and `_` to `.`, and anchors the result. An unanchored regular expression can also turn an indexed lookup
into a collection scan.

## What works today: schema validation

`toJsonSchema` is useful input to a MongoDB collection validator, but its output is not accepted unchanged. MongoDB's JSON Schema subset does not support `format`, while zmdb emits
`format: 'date-time'` and `format: 'int64'`. MongoDB also omits the standard `integer` type in favour of BSON numeric types.

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

// Application code: zmdb does not ship this adapter.
const mongoSchema = adaptJsonSchemaForMongo(toJsonSchema(users, 'entity'));

await db.createCollection('users', {
  validator: { $jsonSchema: mongoSchema },
});
```

The adapter must at least remove unsupported `format` keywords and translate `type: 'integer'` to the BSON numeric types the application actually stores. That keeps the useful part of the recipe — one
declaration feeding validation — without claiming that OpenAPI JSON Schema and MongoDB's validator dialect are identical.

## Using zmdb with MongoDB today

The layers that do not execute database queries remain usable:

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import type { CreateDTO, Entity } from '@zmdb/schema-core';

@Controller('/users')
export class UsersController {
  @Post('/')
  async create(ctx: Ctx<Record<never, string>, unknown>) {
    const dto = assert<CreateDTO<User>>(ctx.body);
    const { insertedId } = await col.insertOne(dto);
    return { ...dto, id: insertedId.toString() };
  }

  @Get('/:id')
  async get(ctx: Ctx<{ id: string }>) {
    const doc = await col.findOne({ _id: new ObjectId(ctx.params.id) });
    return doc === null ? undefined : assert<Entity<User>>(normalise(doc));
  }
}
```

This keeps AOT validation, the web layer, OpenAPI generation and a schema declaration as input to an application-owned MongoDB validator adapter. It does not provide the query builder, repository,
migrations, relations or transactions. The `normalise` step is load-bearing: an `ObjectId` does not satisfy a declared numeric key.

## What would reopen the decision

All three blockers need an answer:

1. the schema vocabulary can declare an externally generated or opaque primary key without changing the declaration per target;
2. `aggregate` has a complete declarative form instead of requiring the SQL-builder callback; and
3. the transaction contract either stops requiring savepoints or explicitly permits a target to refuse that named capability.

Any future implementation would use the existing structural target seam. It would not widen `CompiledQuery`, add a `Target<Q>` parameter to every SQL consumer, or map populate to `$lookup`. No such
work is planned.

---

See also: [Query Compiler](./select.html) · [toJsonSchema](./llm-json-schema.html) · [Gel](./dialect-gel.html)
