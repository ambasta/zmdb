Generate an **OpenAPI 3.1** document from your [controllers](./web-controllers.html) and [schema-derived JSON Schemas](./openapi.html) — the `@nestjs/swagger` analogue, **deterministic** and
reflection-free. It reads controller route metadata plus the same guard, route-option and version-strategy values used by the runtime.

## From routes to a spec

```ts
import { toOpenApi } from '@zmdb/web';
import { toJsonSchema } from '@zmdb/schema-core/openapi';

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

The route `@Get('/:id')` becomes the OpenAPI path `/users/{id}` with a `parameters` entry:

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

## Security comes from the running guards

Pass the same guard registry and per-handler options to the router and generator:

```ts
const router = createRouter({ guardRegistry: GUARD_REGISTRY });
router.register(new UsersController(), ROUTES.UsersController);

const doc = toOpenApi([UsersController], {
  info: { title: 'Users API', version: '1.0.0' },
  securitySchemes: SCHEMES,
  guardRegistry: GUARD_REGISTRY,
  routes: ROUTES,
});
```

`toOpenApi` derives each operation's `security` requirement from the effective app → controller → route guard chain. With strict generation, a route with no guards and no `@Public()` marker is an
error instead of silently appearing public. Declared schemes are emitted under `components.securitySchemes`, while a public route carries the explicit OpenAPI form `security: []`.

See [Security Schemes](./web-openapi-security.html) for all OpenAPI 3.1 scheme types, OAuth2 flows, legacy-guard overrides and the public-endpoint audit.

## Versioned documents

The router and generator receive the same one-strategy value:

```ts
const versioning = { kind: 'header', name: 'accept-version', default: '1' } as const;
const router = createRouter({ versioning });

const doc = toOpenApi([UsersController], {
  versioning,
  versionSchemas: {
    '/users': {
      '1': { response: { type: 'array' } },
      '2': { response: { type: 'array' } },
    },
  },
});
```

Path versioning emits distinct paths, header versioning emits an optional enum parameter with its default, and media-type versioning emits versioned response content keys. Generation refuses document
shapes that cannot represent runtime, such as differing header-versioned schemas.

See [API Versioning](./web-versioning.html) for negotiation, unknown-version responses and generated output for every strategy.

## Serving it

```ts
import { serveOpenApi } from '@zmdb/web';

const openapi = serveOpenApi(doc); // a handler returning the doc, e.g. at /openapi.json
```

## Design notes

- **Deterministic** — paths + methods are emitted in a stable, sorted order.
- **No duplicate declarations** — bodies/responses come from your existing `@zmdb/schema-core` [JSON Schemas](./openapi.html), security comes from the guard objects runtime executes, and version
  representation comes from the router's strategy.
- **Build/boot-time & reflection-free**; **no `as`** on the consumer surface.
- Granular import: `import { toOpenApi } from '@zmdb/web/openapi'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [OpenAPI Operations](./web-openapi-operations.html) · [Security Schemes](./web-openapi-security.html) · [API Versioning](./web-versioning.html) ·
  [OpenAPI (schema-core)](./openapi.html)
