# `@zmdb/web` — zmdb data-layer integration SPEC

> Wire controllers to `@zmdb/repository` + schema-derived DTO validation
> (epic #277). Frozen before code.

## Contract

### Repository injection

- **`repositoryToken<S>(name): Token<BaseRepository<S>>`** — a typed DI token for a
  repository (thin wrapper over `createToken`). Register a `defineRepository(...)`
  instance under it; inject it into a controller with `@Inject`.
- No new machinery beyond `@zmdb/web/di` — this is a documented pattern + a typed
  token helper so the injected field type is the repository (no consumer `as`).

### DTO-bound validation

- **`validateWith(validator)`** — adapt a validator function (e.g. the AOT
  `assert<CreateDTO<S>>`) into a `RouteOptions.validateBody`. Keeps the pipeline's
  hook shape while letting the body type be the schema DTO. The framework does not
  embed a runtime parser; it accepts the consumer's AOT `assert`.

### Orders example (runnable E2E)

- The PRD Orders domain served end-to-end on `node:sqlite`: define `OrderSchema`,
  `defineRepository`, register it under a repository token in a `Container`, build
  a controller that injects it, and dispatch create/get requests through the
  router — request → validated → persisted → typed response.

## Invariants

- **No `as`/`any`/`!` on the consumer surface.** Repository token typing carries
  the schema so the injected repo is fully typed.
- No reflection; validation via the consumer's AOT `assert` (no parser baked in).

## Acceptance

- E2E: POST an order → validated + persisted (row in sqlite), returned typed;
  GET by id → the persisted row; invalid body → 400 (not persisted).
- Injected repository field is typed as `BaseRepository<OrderSchema>` with no
  `as`.
- Suite + typecheck green.

## Out of scope

Validation/serialization _pipes_ as first-class middleware (epic #297), OpenAPI
(#302).
