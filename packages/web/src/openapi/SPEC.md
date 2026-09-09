# `@zmdb/web/openapi` — pure `HttpContractIR` projection

> Issue #683, parent #678. This module is an OpenAPI 3.1 backend over the shared HTTP contract. It does not collect routes, reflect types, resolve guards, or infer operation meaning.

## 1. Public API

```ts
import type { HttpContractIR } from '@zmdb/web/contract';

export interface OpenApiRenderOptions {
  readonly info?: { readonly title: string; readonly version: string };
}

export function toOpenApi(contract: HttpContractIR, options?: OpenApiRenderOptions): OpenApiDocument;

export function serveOpenApi(document: OpenApiDocument): () => OpenApiDocument;
```

The default `info` is `{ title: '@zmdb/web API', version: '0.0.0' }`.

The former controller-array input and its `schemas`, `versionSchemas`, `versioning`, `routes`, `guardRegistry`, and `strictSecurity` options are deleted. `RouteSchemas`, `VersionSchemas`,
`OpenApiOptions`, and `operationIdForRoute` are not public exports. Their information now exists once in `HttpContractIR`.

`SecurityScheme`, `SecurityRequirement`, and the OAuth flow types are re-exported from `@zmdb/web/contract`; OpenAPI does not own parallel copies.

## 2. Ownership and purity

`toOpenApi` is a deterministic pure projection:

- it accepts serialisable `HttpContractIR` and returns a plain serialisable document;
- it reads `HttpTypeIR.openApi` for a referenced `typeId` and never reads `HttpTypeIR.type`;
- it does not import or call `getRoutes`, `versionsOf`, `isPublic`, guard resolution, the TypeScript compiler, `Reflector`, or a TypeIR-to-schema function;
- it does not execute or import a controller;
- it does not mutate or freeze the input; and
- it performs no I/O, registration, network access, or global mutation.

Contract collection and schema projection belong to `@zmdb/web/contract/compiler`. The renderer does not accept a second source that could disagree with that compiler.

## 3. Document root

Every document contains:

```ts
{
  openapi: '3.1.0',
  info,
  paths,
}
```

`components.securitySchemes` is present exactly when the contract's scheme map is non-empty. The renderer emits no document-level `security`.

Security scheme keys sort lexically. Their values are copied from the canonical contract and contain descriptions, URLs, scopes, and formats only—never credentials.

## 4. Operations and ordering

Operations sort by:

1. converted OpenAPI path;
2. lower-case HTTP method; then
3. explicit `operationId`.

The emitted `operationId` is copied from the IR. It is never derived from a controller, handler, method, path, counter, or hash.

A `:name` path slot becomes `{name}`. The renderer refuses:

- duplicate operation IDs;
- two operations with the same final method and OpenAPI path;
- path placeholders that do not exactly match the ordered path parameters;
- a path parameter that is not required; and
- an unsupported method or non-absolute path.

`deprecated: true` is emitted only when the operation says true. False produces no key.

Every operation emits its explicit `security`, including `security: []` for a public operation. Every referenced scheme must exist in `contract.securitySchemes`.

## 5. Parameters

Parameter order is declaration order, followed by the generated version header when header versioning applies. The schema is the exact `HttpTypeIR.openApi` object referenced by `typeId`.

| IR location | OpenAPI mapping                                                             |
| ----------- | --------------------------------------------------------------------------- |
| `path`      | `required: true`, `style: simple`, `explode: false`, `allowReserved: false` |
| `query`     | contract `required`, `style: form`, `explode: true`, `allowReserved: false` |
| `header`    | contract `required`, `style: simple`, `explode: false`                      |
| `cookie`    | contract `required`, `style: form`, `explode: true`                         |

Duplicate wire names within one location are errors. Header names compare case-insensitively.

A missing optional parameter has no OpenAPI default unless its precomputed schema carries one.

## 6. Bodies and exact statuses

An absent request body emits no `requestBody`. A present request body emits its exact media type and `required` flag.

| Body kind | OpenAPI schema                               |
| --------- | -------------------------------------------- |
| `json`    | referenced `HttpTypeIR.openApi`              |
| `text`    | `{ type: 'string' }`                         |
| `bytes`   | `{ type: 'string', format: 'binary' }`       |
| `stream`  | `{ type: 'string', format: 'binary' }`       |
| `empty`   | no response `content`; invalid for a request |

Every `HttpResponseIR` becomes one decimal status key with its declared description. There is no inferred `200`, `default`, status range, or undocumented fallback.

Response headers preserve their exact wire names and declaration order. Each carries its required flag, referenced schema, and description when one was supplied. Duplicate names compare
case-insensitively and are refused.

A JSON `typeId` missing from `contract.types` is an error naming the operation and exact field. The renderer never emits `{}` as a fallback.

## 7. Versioning

### Path

Path-versioned operations already contain their final expanded path and explicit operation ID. The renderer performs no prefix or path expansion.

### Header

One operation carries the accepted values and default. The renderer appends:

```json
{
  "name": "accept-version",
  "in": "header",
  "required": false,
  "style": "simple",
  "explode": false,
  "schema": {
    "type": "string",
    "enum": ["1", "2"],
    "default": "1"
  }
}
```

The value order is the contract order. Values must be non-empty and unique, and the default must be one of them.

### Media type

The request media type remains unversioned. Every response version becomes one content key:

```text
<body media type>; <version key>=<version value>
```

For example, `application/json; version=1`.

When `HttpResponseIR.versions` is absent, the shared response body is emitted for every accepted version. When it is present, it must contain exactly the operation's version values and each value uses
its own body/schema projection.

Per-version response bodies are invalid for every other version strategy.

### Neutral and unversioned

Neutral and unversioned operations emit no version parameter and no versioned media type.

## 8. Determinism and diagnostics

Byte-identical IR plus byte-identical render options produce byte-identical `JSON.stringify` output. Input operation order, response order, security-scheme insertion order, and requirement-key
insertion order cannot perturb the canonical document ordering.

The renderer distrusts hand-built JavaScript values enough to refuse:

- an unknown `contract.format`;
- a missing type projection;
- duplicate operation, route, parameter, response-status, response-header, or media-type identity;
- invalid exact statuses;
- inconsistent paths, versions, response-version maps, or scheme references; and
- an empty request body kind.

Diagnostics begin `OpenAPI contract`, name the operation when one exists, and identify the exact field.

## 9. `serveOpenApi`

`serveOpenApi(document)` returns a zero-argument handler that returns the same prebuilt object by identity on every call. It does not regenerate, clone, validate, or mutate the document.

## 10. Acceptance

The executable suite proves:

1. every parameter location and style;
2. method-specific request/response schemas for two methods sharing one path;
3. JSON, text, bytes, stream, and empty body mappings;
4. every exact status and response header;
5. public and protected security plus every OpenAPI 3.1 scheme arm;
6. path, header, media-type, neutral, and unversioned operations;
7. explicit operation IDs, stable ordering, and collision refusal;
8. OpenAPI 3.1 schema validation;
9. byte-identical output from the same IR;
10. a hostile `HttpTypeIR.type` getter is never read; and
11. static source inspection finds no controller, guard, compiler, reflector, or schema-projector dependency.

## 11. Non-goals

- collecting controllers, decorators, route options, or guard registries;
- accepting path-keyed schema maps;
- deriving operation IDs;
- parsing OpenAPI to generate a client;
- traversing TypeIR or opening a compiler session;
- hoisting inline schemas into named components; or
- inferring undocumented statuses, bodies, security, or versions.
