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

## Out of scope

Auto-deriving schemas from handler signatures (kept explicit via `options.schemas`

- schema-core's `toJsonSchema`).
