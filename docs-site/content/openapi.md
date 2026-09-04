The OpenAPI generation system produces OpenAPI 3.x compatible component schemas from a zmdb table declaration. This enables automatic API documentation, client SDK generation, and validation layer
interoperability.

> 📄 **Download Specification:** [Download full OpenAPI 3.0 specification (openapi.json)](../openapi.json) generated directly from core schema definitions upon every site build.

> [!NOTE] OpenAPI schemas are derived at build time from your table declarations. There's no runtime reflection — the generation is deterministic and happens during the build process.

## Generating Components

The `toOpenApiComponents` function generates a map of schemas ready for OpenAPI specification:

<!-- snippet: openapi.ts#snippet-1 -->

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

<!-- snippet: openapi.ts#snippet-2 -->

> [!IMPORTANT] The `get`, `list`, and `search` variants include auto-increment columns since those are present in responses. The `create` variant excludes them because the database generates them.

## Integration with Express/Fastify

Combine OpenAPI generation with your HTTP framework:

<!-- snippet: openapi.ts#snippet-3 -->

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

There is no `Enum` tag, because a literal union already says it and TypeScript checks it everywhere a flag would not.

<!-- snippet: openapi.ts#snippet-4 -->

## Full OpenAPI Spec Generation

Generate a complete spec by combining components:

<!-- snippet: openapi.ts#snippet-5 -->

> [!TIP] The generated spec can be exported as JSON/YAML and fed into tools like Swagger UI, Redoc, or OpenAPI Generator for client SDKs.

## Search Schema (Full-Text Search)

For full-text search endpoints, use `toSearchSchema` which includes relevance scoring:

<!-- snippet: openapi.ts#snippet-6 -->

- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-tags](./validators-tags.html) — validation tags
- [random](./random.html) — test data generation
