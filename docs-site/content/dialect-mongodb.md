> **ToDo / feature gap.** There is no MongoDB support. The query compiler emits
> SQL text and `CompiledQuery` is `{ text: string; parameters: readonly unknown[] }`,
> so there is no representation for a document-store query. `Dialect` is
> `'postgres' | 'mysql' | 'sqlite'`.

## Why it is not a dialect

A dialect changes how a query is _written_. MongoDB changes what a query _is_:

|              | SQL dialects               | MongoDB                                       |
| ------------ | -------------------------- | --------------------------------------------- |
| Query        | one string plus parameters | a command document, or a pipeline of them     |
| Schema       | enforced by the server     | none, or a JSON Schema validator you opt into |
| Joins        | `JOIN`                     | `$lookup` in an aggregation, with real limits |
| Transactions | universal                  | replica sets and sharded clusters only        |
| Keys         | your column                | `_id`, an `ObjectId` unless you override it   |

`CompiledQuery` being a string is the concrete blocker. Supporting Mongo means the compiler's output type becomes a union, which means every driver, every test that reads `q.text`, and the `Driver` interface itself change shape. That is not an addition, it is a widening of the project's central data type.

## Where the schema model diverges

The deeper mismatch is that a `Table<…>` declaration describes a **table with enforced columns**. Mongo's equivalent is a collection with a shape by convention. You can bring the two together — `$jsonSchema` validators — and there is a real feature hiding in that:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

await db.createCollection('users', {
  validator: { $jsonSchema: toJsonSchema(users, 'entity') },
});
```

`toJsonSchema` exists today and produces a document Mongo accepts. So you can already get schema enforcement in Mongo derived from a zmdb schema object, without any dialect support. That is worth knowing even though the query side is missing.

## Using zmdb with Mongo today

The layers without SQL in them all work:

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import type { Entity, CreateDTO } from '@zmdb/schema-core';

@Controller('/users')
export class UsersController {
  @Post('/')
  async create(ctx: Ctx<Record<never, string>, unknown>) {
    const dto = assert<CreateDTO<typeof users>>(ctx.body);
    const { insertedId } = await col.insertOne(dto);
    return { ...dto, id: insertedId.toString() };
  }

  @Get('/:id')
  async get(ctx: Ctx<{ id: string }>) {
    const doc = await col.findOne({ _id: new ObjectId(ctx.params.id) });
    return doc === null ? undefined : assert<Entity<typeof users>>(normalise(doc));
  }
}
```

You keep: the schema object as the single declaration, generated validators at the boundary, `toJsonSchema` for collection validation, `toOpenApi` for the document, and all of `@zmdb/web`. You lose: the query builder, the repository, migrations, and relations.

Note the `normalise` — `_id` as an `ObjectId` does not satisfy an `id: number` field, and the validator will correctly say so. Mapping `_id` is the first thing you write and the thing a real integration would have to decide globally.

## What it would take

`CompiledQuery` becomes a discriminated union (`{ kind: 'sql', text, parameters }` | `{ kind: 'mongo', command }`), `Driver.execute` accepts it, and a second compiler emits command documents from the same builder calls. `WhereDTO`'s `FieldOps` maps almost directly onto Mongo's operators, so the filter half is genuinely close. `populate` maps to `$lookup`; migrations map to nothing, since there is no DDL.

The blocker is not any of that individually — it is that the union touches every driver and every test in the project, for a target whose schema model is a different shape. There is no work planned.

---

See also: [Query Compiler](./select.html) · [toJsonSchema](./llm-json-schema.html) · [Gel](./dialect-gel.html)
