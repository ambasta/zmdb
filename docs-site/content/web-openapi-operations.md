`toOpenApi(httpContractIR, options)` produces an OpenAPI 3.1 document from explicit operation objects. It is an output backend, not a route collector.

## One operation object

Each `HttpOperationIR` already contains:

- explicit `operationId`, method, and final public path;
- path, query, header, and cookie parameters with referenced schema IDs;
- an optional request body;
- every exact response status, response header, body kind, and media type;
- explicit security requirements;
- version strategy and values; and
- deprecation.

The renderer copies those facts. It does not inspect a handler or infer a default response.

```ts
import { toOpenApi } from '@zmdb/web/openapi';

const document = toOpenApi(compiled.ir, {
  info: { title: 'Blog API', version: '1.0.0' },
});
```

## Two methods on one path

Schemas are method-specific because they are referenced by each operation:

```ts
operations: [
  {
    operationId: 'listPosts',
    method: 'GET',
    path: '/posts',
    requestBody: undefined,
    responses: [/* GET schemas */],
  },
  {
    operationId: 'createPost',
    method: 'POST',
    path: '/posts',
    requestBody: {/* POST schema typeId */},
    responses: [/* POST schemas */],
  },
];
```

The emitted `/posts` path item has both `get` and `post`, but only `post` has a request body. No path-only lookup can attach the POST schema to GET.

## Parameters

| Location | OpenAPI representation                                            |
| -------- | ----------------------------------------------------------------- |
| path     | required, `simple`, not exploded, reserved characters encoded     |
| query    | contract requiredness, `form`, exploded; arrays use repeated keys |
| header   | contract requiredness, `simple`, not exploded                     |
| cookie   | contract requiredness, `form`, exploded                           |

The schema is the exact precomputed projection at the parameter's `typeId`. A missing type ID is an error, not an empty schema.

## Bodies

| Contract kind  | OpenAPI schema               |
| -------------- | ---------------------------- |
| JSON           | referenced schema projection |
| text           | string                       |
| bytes          | binary string                |
| stream         | binary string                |
| empty response | no `content`                 |

A request body also carries its exact media type and required flag. An empty request body kind is invalid.

## Responses

Every declared status becomes one decimal key:

```json
{
  "responses": {
    "201": {
      "description": "Created",
      "content": {
        "application/json": {
          "schema": { "type": "object" }
        }
      }
    },
    "409": {
      "description": "Conflict",
      "content": {
        "application/problem+json": {
          "schema": { "type": "object" }
        }
      }
    },
    "204": {
      "description": "No content"
    }
  }
}
```

There is no inferred `200`, range response, `default`, or undocumented fallback. Response headers retain their wire name, requiredness, schema, and optional description.

## Operation identity and ordering

`operationId` is copied from the contract key chosen by the application. It is not derived from method or path. Duplicate IDs and duplicate final method/path pairs are errors.

Documents sort by converted path, lower-case method, and operation ID. Responses sort numerically and security-scheme keys sort lexically, so unchanged input produces byte-identical JSON.

## Fields not invented

The renderer does not invent summaries, descriptions, tags, examples, callbacks, links, servers, or external documentation. Add prose metadata in a separate deterministic post-processing step if your
application owns it; do not recollect route meaning.

## Serving it

`serveOpenApi(document)` returns `() => document`. Build once, commit or check the generated JSON in CI, and serve the prebuilt object.

---

See also: [OpenAPI Generation](./web-openapi.html) · [OpenAPI schemas](./openapi.html) · [OpenAPI Security](./web-openapi-security.html) · [API Versioning](./web-versioning.html)
