# `@zmdb/web` — validation & serialization pipes SPEC

> First-class pipes binding routes to schema-derived DTO validation + entity
> serialization (epic #297). Builds on middleware (#287) + data (#277). Frozen.

## Contract

### `validationPipe(validator)`
A `Pipe<unknown, T>` (from `@zmdb/web/middleware`) that runs a validator (e.g.
`@zmdb/aot-validator`'s `assert<CreateDTO<S>>`) on the body and yields the typed
value; a throw becomes the chain's 400. The NestJS `ValidationPipe` analogue,
but zero-runtime-parser (the consumer supplies the AOT `assert`).

### `serializationInterceptor(serialize?)`
An `Interceptor` that serializes the handler's result via a provided serializer
(default: identity — the pipeline already JSON-encodes). When given
`@zmdb/aot-validator`'s `stringify`/entity serializer, it produces the response
body from `Entity<S>`. The NestJS `ClassSerializerInterceptor` analogue.

### Convenience
- `dtoChain({ validate, serialize? })` → a `Chain` with the validation pipe (+
  optional serialization interceptor) pre-composed, so a route can adopt DTO
  validation in one call.

## Invariants
- **No `as`/`any`/`!` on the consumer surface.** The pipe's `Out` type is the DTO
  type, so the handler body is typed by the pipe (no assertion).
- No runtime parser embedded; validation is the consumer's AOT `assert`.

## Acceptance
- A route using `validationPipe` rejects an invalid body (400 via the chain) and
  passes a valid, typed body to the handler.
- `serializationInterceptor` emits the handler result via the provided serializer.
- `dtoChain` composes both.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope
OpenAPI generation (epic #302).
