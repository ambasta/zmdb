The OpenAPI generation system produces OpenAPI 3.x compatible component schemas from a zmdb table declaration. This enables automatic API documentation, client SDK generation, and validation layer interoperability.

> 📄 **Download Specification:** [Download full OpenAPI 3.0 specification (openapi.json)](../openapi.json) generated directly from core schema definitions upon every site build.

> [!NOTE]
> OpenAPI schemas are derived at build time from your table declarations. There's no runtime reflection — the generation is deterministic and happens during the build process.

## Generating Components

The `toOpenApiComponents` function generates a map of schemas ready for OpenAPI specification:

```ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';
import { schemaOf } from 'zmdb';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
  age: (number & Sql<'integer'>) | null;
}

const { schemas } = toOpenApiComponents([schemaOf<User>()]);
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

const userSchema = schemaOf<User>();

// GET /users/{id} — single entity response
const getSchema = toJsonSchema(userSchema, 'get');
// All fields required, includes auto-increment

// POST /users — create request
const createSchema = toJsonSchema(userSchema, 'create');
// Excludes id (auto-increment), all fields required

// PATCH /users/{id} — update request
const updateSchema = toJsonSchema(userSchema, 'update');
// All fields optional, excludes id

// GET /users — list response (includes pagination envelope)
import { toListSchema } from '@zmdb/schema-core/openapi';
const listSchema = toListSchema(userSchema);
```

> [!IMPORTANT]
> The `get`, `list`, and `search` variants include auto-increment columns since those are present in responses. The `create` variant excludes them because the database generates them.

## Integration with Express/Fastify

Combine OpenAPI generation with your HTTP framework:

```ts
import { toJsonSchema, toListSchema } from '@zmdb/schema-core/openapi';
import { schemaOf } from 'zmdb';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  email: string & Sql<'text'>;
}

const userSchema = schemaOf<User>();

// Endpoint definitions with OpenAPI schema
const routes = [
  {
    method: 'GET',
    path: '/users',
    schema: {
      response: {
        200: toListSchema(userSchema),
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
      response: { 200: toJsonSchema(userSchema, 'get') },
    },
    handler: async (req, reply) => {
      return repo.findById(req.params.id);
    },
  },
];
```

## Validation Tag Mapping

Tags on a column map to OpenAPI schema keywords:

| Tag             | OpenAPI Keyword | Example                   |
| --------------- | --------------- | ------------------------- |
| `Min<N>`        | `minimum`       | `{ "minimum": 0 }`        |
| `Max<N>`        | `maximum`       | `{ "maximum": 100 }`      |
| `MinLength<N>`  | `minLength`     | `{ "minLength": 1 }`      |
| `MaxLength<N>`  | `maxLength`     | `{ "maxLength": 255 }`    |
| `Length<N>`     | `maxLength`     | `{ "maxLength": 255 }`    |
| `Pattern<S>`    | `pattern`       | `{ "pattern": "^\\d+$" }` |
| a literal union | `enum`          | `{ "enum": ["a", "b"] }`  |

There is no `Enum` tag, because a literal union already says it and TypeScript checks it
everywhere a flag would not.

```ts
interface Account extends Table<'accounts'> {
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'> & MaxLength<255>;
  age: (number & Sql<'integer'> & Min<0>) | null;
}

const schema = toJsonSchema(schemaOf<Account>(), 'entity');
// email: { type: 'string', pattern: '^[^@]+@[^@]+\.[^@]+$', maxLength: 255 }
// age: { type: ['integer', 'null'], minimum: 0 }
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
                schema: toListSchema(userSchema),
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
              schema: toJsonSchema(userSchema, 'create'),
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: toJsonSchema(userSchema, 'entity'),
              },
            },
          },
        },
      },
    },
  },
  components: toOpenApiComponents([userSchema]),
};
```

> [!TIP]
> The generated spec can be exported as JSON/YAML and fed into tools like Swagger UI, Redoc, or OpenAPI Generator for client SDKs.

## Search Schema (Full-Text Search)

For full-text search endpoints, use `toSearchSchema` which includes relevance scoring:

```ts
import { toSearchSchema } from '@zmdb/schema-core/openapi';

const searchSchema = toSearchSchema(userSchema);
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
