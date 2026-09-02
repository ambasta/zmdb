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

### The wire↔app crossing

A column has three types — the DDL type, the app type (`Date`, `bigint`) and the wire
type (an ISO-8601 string, a decimal string). JSON carries only the third; a handler, a
`CreateDTO<S>` and the repository all hold the second. Two functions convert, at the
boundary and nowhere else:

- **`wireDecoder(schema, variant?, codecs?)`** — `(raw: unknown) => unknown`, for a
  request body. Converts the columns JSON cannot carry and **rejects nothing**: a string
  that is not a date stays a string, so the validator reports it instead of the handler
  receiving an `Invalid Date`. Unknown keys pass through untouched, for the excess-key
  check to name. Non-object bodies pass through. Runs _before_ validation.
- **`wireEncoder(schema, codecs?)`** — `(result: unknown) => unknown`, for a response;
  array-aware. A `bigint` does not survive `JSON.stringify` at all, so this is what makes
  the response serializable, not merely well-formatted.
- Both build the IR once per route. `codecs` supplies a `Codec` for a column tagged with a
  custom type; a tag naming a codec absent from the registry throws rather than guessing.
- "No runtime parser" still holds: these convert, and validation remains the consumer's
  AOT `assert`.

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
- E2E: POST an event whose `at` is an ISO string and whose `seq` is a decimal string →
  decoded to a `Date`/`bigint`, validated, persisted as the DDL's `TEXT`/`INTEGER`, and
  returned as the wire forms again; a body whose date is not one → 400, nothing persisted.
- Injected repository field is typed as `BaseRepository<OrderSchema>` with no
  `as`.
- Suite + typecheck green.

## Out of scope

Validation/serialization _pipes_ as first-class middleware (epic #297), OpenAPI
(#302).
