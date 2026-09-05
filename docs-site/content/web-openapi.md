Generate an **OpenAPI 3.1** document from the same compiled HTTP contract used by routing and generated clients. OpenAPI and the client module are sibling outputs; neither is derived from the other.
`@zmdb/web/openapi` is a pure renderer: it does not inspect controllers, decorators, guards, TypeScript types, or `TypeIR`.

## Render the shared contract

Compile your explicit declaration through `@zmdb/web/contract/compiler`, then pass only its serialisable IR:

```ts
import { compileHttpContracts } from '@zmdb/web/contract/compiler';
import { toOpenApi } from '@zmdb/web/openapi';

const compiled = compileHttpContracts([{ file: import.meta.url, exportName: 'HTTP_CONTRACT', contract: HTTP_CONTRACT }], { session });

const document = toOpenApi(compiled.ir, {
  info: { title: 'Users API', version: '1.0.0' },
});
```

`session` is the caller-owned `ReflectSession` already used by your build. Contract compilation performs the one TypeScript-to-`TypeIR` pass and stores each OpenAPI schema projection beside a stable
`typeId`. Rendering reads only those projections.

There is no controller-array overload and no path-keyed `schemas` option. Method, path, parameters, bodies, exact statuses, security, versions, deprecation, and operation ID already belong to each
`HttpOperationIR`.

## What is emitted

A contract path `/users/:id` becomes `/users/{id}`. Parameter placement and wire style come from the IR:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Users API", "version": "1.0.0" },
  "paths": {
    "/users/{id}": {
      "get": {
        "operationId": "getUser",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "style": "simple",
            "explode": false,
            "allowReserved": false,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": {
            "description": "Found",
            "content": {
              "application/json": {
                "schema": { "type": "object" }
              }
            }
          },
          "404": {
            "description": "Not found",
            "content": {
              "application/problem+json": {
                "schema": { "type": "object" }
              }
            }
          }
        },
        "security": [{ "bearerAuth": [] }]
      }
    }
  }
}
```

The renderer copies the explicit operation ID and every exact response. It does not derive a name or invent `200`.

## Versions

- Path-versioned operations already carry their final expanded paths.
- Header versioning appends one optional header parameter with the contract's ordered enum and default.
- Media-type versioning emits response keys such as `application/json; version=1`; the request media type stays unversioned.
- Neutral and unversioned operations add no version field.

See [API Versioning](./web-versioning.html) for declaration and routing behavior.

## Security

Every operation emits its explicit `security`, including `security: []` for public operations. Scheme declarations appear under `components.securitySchemes` only when the contract has schemes.

Contract registration compares the runtime guard chain with the same operation security and refuses disagreement. OpenAPI does not derive security independently. See
[Security Schemes](./web-openapi-security.html).

## Serving it

```ts
import { serveOpenApi } from '@zmdb/web/openapi';

const openapi = serveOpenApi(document);
```

The returned handler serves the same prebuilt object by identity; it never recompiles the contract per request.

## Design notes

- Deterministic ordering: path, lower-case method, explicit operation ID.
- Method-specific schemas: `GET /users` and `POST /users` can share a path without sharing a request body.
- Inline schemas: each JSON body or parameter copies its referenced `HttpTypeIR.openApi` value.
- Fail closed: missing type IDs, duplicate operations, inconsistent paths, statuses, versions, or security schemes are generation errors.
- Granular import: `import { toOpenApi } from '@zmdb/web/openapi'`.

## Cross-links

- [Generated HTTP Client](./generated-client.html) · [HTTP contract declarations](./web-http-client.html) · [OpenAPI Operations](./web-openapi-operations.html) ·
  [Security Schemes](./web-openapi-security.html) · [API Versioning](./web-versioning.html) · [OpenAPI schemas](./openapi.html)
