Generate an **OpenAPI 3.1** document from your [controllers](./web-controllers.html)
and [schema-derived JSON Schemas](./openapi.html) — the `@nestjs/swagger`
analogue, **deterministic** and reflection-free (it reads the route table + the
schemas you already have).

## From routes to a spec

```ts
import { toOpenApi } from '@zmdb/web';
import { toJsonSchema } from '@zmdb/schema-core';

const doc = toOpenApi([UsersController], {
  info: { title: 'Users API', version: '1.0.0' },
  schemas: {
    '/users': {
      body: toJsonSchema(UserSchema, 'create'),
      response: toJsonSchema(UserSchema, 'entity'),
    },
  },
});
```

The route `@Get('/:id')` becomes the OpenAPI path `/users/{id}` with a
`parameters` entry:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Users API", "version": "1.0.0" },
  "paths": {
    "/users/{id}": {
      "get": {
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/users": {
      "post": {
        "requestBody": { "content": { "application/json": { "schema": {/* create DTO */} } } },
        "responses": { "200": { "content": { "application/json": { "schema": {/* entity */} } } } }
      }
    }
  }
}
```

## Serving it

```ts
import { serveOpenApi } from '@zmdb/web';

const openapi = serveOpenApi(doc); // a handler returning the doc, e.g. at /openapi.json
```

## Design notes

- **Deterministic** — paths + methods are emitted in a stable, sorted order.
- **No duplicate declarations** — bodies/responses come from your existing
  `@zmdb/schema-core` [JSON Schemas](./openapi.html), so the API contract can't
  drift from the schema.
- **Build/boot-time & reflection-free**; **no `as`** on the consumer surface.
- Granular import: `import { toOpenApi } from '@zmdb/web/openapi'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [OpenAPI (schema-core)](./openapi.html)
