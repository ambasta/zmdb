# `@zmdb/web` — OpenAPI generation SPEC

> Generate OpenAPI 3.1 from the route table + schema-derived JSON Schemas
> (epic #302). Builds on routing (#252) + schema-core openapi. Frozen.

## Contract

### `toOpenApi(controllers, options?)`

- Input: an array of controller **classes** (or instances), plus `options`:
  - `info?: { title; version }` (defaults provided),
  - `schemas?: Record<routePath, { body?; response? } schema>` — optional
    per-route JSON Schemas produced from `@zmdb/schema-core`'s `toJsonSchema`.
- Reads each controller's routes via `getRoutes`, and emits an
  **OpenAPI 3.1 document**:
  - `openapi: '3.1.0'`, `info`,
  - `paths`: one entry per route; the zmdb `/users/:id` path is converted to the
    OpenAPI `/users/{id}` form, with a `parameters` entry (`in: 'path'`,
    `required: true`, string) per derived param,
  - request body / responses filled from `options.schemas` when provided.
- **Deterministic**: paths and methods emitted in a stable (sorted) order.

### `serveOpenApi(doc)` (optional)

A tiny helper returning a route handler (`Ctx → the doc`) so an app can expose
`/openapi.json`.

## Invariants

- Generation is **build/boot-time**, pure, and **reflection-free** (reads
  `getRoutes` + provided schemas).
- **No `as`/`any`/`!` on the consumer surface.**

## Acceptance

- `toOpenApi([UsersController])` yields a 3.1 doc whose `paths` include the
  controller's routes with `{param}` path params + a `parameters` array; methods
  are lowercased operation keys; output is deterministic.
- Provided body/response schemas appear under the right operation.
- No consumer-surface `as`; suite + typecheck green.

## `operationId` (frozen — epic "The agent runtime")

`toOpenApi` emits an `operationId` on every operation, and `RouteSchemas` gains an optional
`operationId?: string` to override it. Derived form: the lowercased method, then the path with `/` and `:`
replaced by `_`, leading and trailing separators dropped — `POST /users/:id/roles` becomes
`post_users_id_roles`. Deterministic, like the path ordering above; a collision throws at generation, because
two routes with the same method and path is already a routing bug.

Why a document generator cares: `toolsFromOpenApi`
(`packages/schema-core/src/llm/http/SPEC.md` §5) uses `operationId` as the tool name, and a tool name has to be
stable across regenerations. A renamed tool is a _new_ tool as far as a model is concerned, and it invalidates
the prompt caches that make a tool loop affordable. An `operationId` that is derived from the route rather than
from a counter or a hash changes only when the route does.

Still not emitted, and named here so the round-trip requirement in that file stays honest: no `query` or
`header` parameters, no `security`, no `tags`, no per-status responses beyond the `200`, and a `schemas` map
keyed by route path — so two methods on one path share one body schema.

## Out of scope

Auto-deriving schemas from handler signatures. It stays explicit, via `options.schemas` plus schema-core's
`toJsonSchema`.
