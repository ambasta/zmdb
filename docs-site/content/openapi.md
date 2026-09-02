The OpenAPI generation system produces OpenAPI 3.x compatible component schemas from zmdb schema definitions. This enables automatic API documentation, client SDK generation, and validation layer interoperability.

> 📄 **Download Specification:** [Download full OpenAPI 3.0 specification (openapi.json)](../openapi.json) generated directly from core schema definitions upon every site build.

> [!NOTE]
> OpenAPI schemas are derived at build time from your schema-core definitions. There's no runtime reflection — the generation is deterministic and happens during the build process.

## Generating Components

The `toOpenApiComponents` function generates a map of schemas ready for OpenAPI specification:

```ts
import { defineSchema, text, integer, serial, jsonEnum } from '@zmdb/schema-core';
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
  age: integer().nullable(),
});

const { schemas } = toOpenApiComponents([UserSchema]);
```

```json
{
  "schemas": {
    "User": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "email": { "type": "string" },
        "role": { "type": "string", "enum": ["admin", "user"] },
        "age": { "type": ["integer", "null"] }
      },
      "required": ["id", "email", "role"]
    }
  }
}
```

## DTO-Based Schema Generation

For API endpoints, generate schemas specific to each operation:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

// GET /users/{id} — single entity response
const getSchema = toJsonSchema(UserSchema, 'get');
// All fields required, includes auto-increment

// POST /users — create request
const createSchema = toJsonSchema(UserSchema, 'create');
// Excludes id (auto-increment), all fields required

// PATCH /users/{id} — update request
const updateSchema = toJsonSchema(UserSchema, 'update');
// All fields optional, excludes id

// GET /users — list response (includes pagination envelope)
import { toListSchema } from '@zmdb/schema-core/openapi';
const listSchema = toListSchema(UserSchema);
```

> [!IMPORTANT]
> The `get`, `list`, and `search` variants include auto-increment columns since those are present in responses. The `create` variant excludes them because the database generates them.

## Integration with Express/Fastify

Combine OpenAPI generation with your HTTP framework:

```ts
import { defineSchema, text, integer, serial } from '@zmdb/schema-core';
import { toJsonSchema, toListSchema } from '@zmdb/schema-core/openapi';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
});

// Endpoint definitions with OpenAPI schema
const routes = [
  {
    method: 'GET',
    path: '/users',
    schema: {
      response: {
        200: toListSchema(UserSchema),
      },
    },
    handler: async (req, reply) => {
      return repo.findAll();
    },
  },
  {
    method: 'GET',
    path: '/users/{id}',
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      response: { 200: toJsonSchema(UserSchema, 'get') },
    },
    handler: async (req, reply) => {
      return repo.findById(req.params.id);
    },
  },
];
```

## Validation Tag Mapping

Tags in your schema map to OpenAPI schema keywords:

| Tag              | OpenAPI Keyword | Example                   |
| ---------------- | --------------- | ------------------------- |
| `Min(n)`         | `minimum`       | `{ "minimum": 0 }`        |
| `Max(n)`         | `maximum`       | `{ "maximum": 100 }`      |
| `MinLength(n)`   | `minLength`     | `{ "minLength": 1 }`      |
| `MaxLength(n)`   | `maxLength`     | `{ "maxLength": 255 }`    |
| `Pattern(regex)` | `pattern`       | `{ "pattern": "^\\d+$" }` |
| `Enum(...vals)`  | `enum`          | `{ "enum": ["a", "b"] }`  |

```ts
const UserSchema = defineSchema('users', {
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$')).validate(tags.MaxLength(255)),
  age: integer().validate(tags.Min(0)),
});

const schema = toJsonSchema(UserSchema, 'entity');
// email: { type: 'string', pattern: '^[^@]+@[^@]+\.[^@]+$', maxLength: 255 }
// age: { type: 'integer', minimum: 0 }
```

## Full OpenAPI Spec Generation

Generate a complete spec by combining components:

```ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';

const fullSpec = {
  openapi: '3.0.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        responses: {
          200: {
            description: 'User list',
            content: {
              'application/json': {
                schema: toListSchema(UserSchema),
              },
            },
          },
        },
      },
      post: {
        summary: 'Create user',
        requestBody: {
          content: {
            'application/json': {
              schema: toJsonSchema(UserSchema, 'create'),
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: toJsonSchema(UserSchema, 'entity'),
              },
            },
          },
        },
      },
    },
  },
  components: toOpenApiComponents([UserSchema]),
};
```

> [!TIP]
> The generated spec can be exported as JSON/YAML and fed into tools like Swagger UI, Redoc, or OpenAPI Generator for client SDKs.

## Search Schema (Full-Text Search)

For full-text search endpoints, use `toSearchSchema` which includes relevance scoring:

```ts
import { toSearchSchema } from '@zmdb/schema-core/openapi';

const searchSchema = toSearchSchema(UserSchema);
// {
//   "type": "object",
//   "properties": {
//     "items": {
//       "type": "array",
//       "items": {
//         "type": "object",
//         "properties": {
//           "id": { "type": "integer" },
//           "name": { "type": "string" },
//           ...
//           "_score": { "type": "number" }  // FTS ranking
//         },
//         "required": ["id", "name", ...]
//       }
//     },
//     "total": { "type": "integer" },
//     "hasMore": { "type": "boolean" },
//     "cursor": { "type": "string" }
//   },
//   "required": ["hasMore", "items"]
// }
```

- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-tags](./validators-tags.html) — validation tags
- [random](./random.html) — test data generation
