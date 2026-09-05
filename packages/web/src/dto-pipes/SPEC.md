# `@zmdb/web` — validation & serialization pipes SPEC

> First-class pipes binding routes to schema-derived DTO validation + entity serialization (epic #297). Builds on middleware (#287) + data (#277). Frozen.

## Contract

### `validationPipe(validator)`

A `Pipe<unknown, T>` (from `@zmdb/web/middleware`) that runs a validator (e.g. `@zmdb/aot-validator`'s `assert<CreateDTO<S>>`) on the body and yields the typed value; a throw becomes the chain's 400.
The NestJS `ValidationPipe` analogue, but zero-runtime-parser (the consumer supplies the AOT `assert`).

### `decodePipe(decode)`

A `Pipe<In, Out>` that only converts: the wire→app decode at the boundary, e.g. `wireDecoder(Schema, 'create')` from `@zmdb/web/data`. Kept separate from `validationPipe` because the two do different
jobs and the order matters — the validator checks the _app_ type, which is only what the body holds once the ISO string JSON carries has become a `Date`. Decoding after validation would validate the
wrong layer, and doing both in one function is how a validator ends up accepting `Date | string` and checking neither.

### `multipartPipe(limits?)`

A `Pipe<unknown, Multipart>` that parses the adapter's exact request bytes with the mandatory defaults from `../upload/SPEC.md`. Missing or malformed multipart framing is `400`; parser limits are
`413`; neither reaches the inner handler. Place the ordinary `validationPipe` after it to validate form fields.

### `serializationInterceptor(serialize?)`

An `Interceptor` that serializes the handler's result via a provided serializer (default: identity — the pipeline already JSON-encodes). When given `@zmdb/aot-validator`'s `stringify`/entity
serializer, it produces the response body from `Entity<S>`. The NestJS `ClassSerializerInterceptor` analogue.

### Convenience

- `dtoChain({ validate, decode?, serialize? })` → a `Chain` with the validation pipe (+ optional decode pipe and serialization interceptor) pre-composed, so a route can adopt DTO validation in one
  call. `decode` runs first; omitted, the chain keeps its single pipe.

## Invariants

- **No `as`/`any`/`!` on the consumer surface.** The pipe's `Out` type is the DTO type, so the handler body is typed by the pipe (no assertion).
- No runtime parser embedded; validation is the consumer's AOT `assert`.

## Acceptance

- A route using `validationPipe` rejects an invalid body (400 via the chain) and passes a valid, typed body to the handler.
- `serializationInterceptor` emits the handler result via the provided serializer.
- `decodePipe` converts and asserts nothing; `dtoChain({ decode, validate })` hands the handler a `Date` for an ISO string in the body, and a 400 for a value the decode could not convert.
- `multipartPipe` preserves file bytes, enforces the upload limits and feeds its parsed fields through the ordinary validation pipe.
- `dtoChain` composes both.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

OpenAPI generation (epic #302).
