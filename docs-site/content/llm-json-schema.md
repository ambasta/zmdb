`toJsonSchema` turns a schema object into a JSON Schema document. That is the currency every LLM API and every other validation library speaks, so it is the bridge out of zmdb's type system.

## Basic use

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { users } from './schema.js';

const schema = toJsonSchema(users, 'entity');
```

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "integer" },
    "email": { "type": "string" },
    "active": { "type": "boolean" }
  },
  "required": ["id", "email", "active"]
}
```

## Variants

The second argument picks which shape of the schema you want, and they differ in exactly the ways the DTO types differ:

| Variant    | Contains                                                 |
| ---------- | -------------------------------------------------------- |
| `'entity'` | every column — the full row                              |
| `'create'` | omits `serial`; `defaultTo` columns optional             |
| `'update'` | every column optional                                    |
| `'get'`    | the lookup shape (`select`, `populate`)                  |
| `'list'`   | the list envelope (`where`, `orderBy`, `page`, `select`) |
| `'search'` | the full-text search shape                               |

```ts
toJsonSchema(users, 'create'); // what a POST body must look like
toJsonSchema(users, 'update'); // what a PATCH body may look like
```

`toListSchema(users)` and `toSearchSchema(users)` are the direct forms of the last two.

## Validation rules become constraints

A `validate()` rule on a column is metadata, and this is where it pays off:

```ts
email: text().notNull().validate({ kind: 'pattern', value: '^[^@]+@[^@]+$' }),
age: integer().nullable().validate({ kind: 'maximum', value: 120 }),
```

```json
{
  "email": { "type": "string", "pattern": "^[^@]+@[^@]+$" },
  "age": { "type": ["integer", "null"], "maximum": 120 }
}
```

So a rule written once shapes the OpenAPI document, the LLM tool schema and any consumer generating a form — without being re-declared anywhere.

## Sensitive columns are omitted

```ts
passwordHash: text().notNull().sensitive(),
```

Absent from the output, in every variant. This is what makes it safe to hand a derived schema to a model or publish it in a document — a column marked sensitive cannot leak through the schema, even if someone forgets it exists.

## Relations

```ts
import { toJsonSchemaWithRelations } from '@zmdb/schema-core/openapi';

toJsonSchemaWithRelations(users, { posts: oneToMany(posts, 'authorId') }, 'entity');
```

Adds `posts` as an array of the target's entity schema — the shape a `populate` actually returns, so the document matches the response.

## Every schema at once

```ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const components = toOpenApiComponents([users, posts, comments]);
```

Keyed by table name and variant, ready to drop into an OpenAPI document's `components.schemas`, or to serve as a manifest of your data model. See [OpenAPI](./openapi.html).

## Feeding it to a model

The direct use is a structured-output constraint:

```ts
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-opus-5',
    max_tokens: 1024,
    tools: [{ name: 'save_user', description: 'Save a user', input_schema: toJsonSchema(users, 'create') }],
    tool_choice: { type: 'tool', name: 'save_user' },
    messages: [{ role: 'user', content: text }],
  }),
});
```

The model's output is now constrained to the shape your database accepts — and `toolFromSchema` wraps exactly this. See [Structured Output](./llm-structured-output.html).

## Out to other validators

Zod, Valibot, TypeBox and ArkType all import JSON Schema, so this is the interop path:

```ts
import { jsonSchemaToZod } from 'json-schema-to-zod';
const zodSchema = jsonSchemaToZod(toJsonSchema(users, 'create'));
```

You do not need this for validation — the [AOT validators](./validators-assert.html) work from the TypeScript type directly — but it is how you hand a shape to a library that is already in your stack. See [Zod](./interop-zod.html).

---

See also: [Structured Output](./llm-structured-output.html) · [OpenAPI](./openapi.html) · [Zod](./interop-zod.html)
