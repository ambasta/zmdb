# `@zmdb/web` — guards, pipes, interceptors & filters SPEC

> The request middleware chain (epic #287). Frozen before code. Composed
> statically per route; no per-request reflection.

## Contract

### Interfaces

- **`Guard`** — `{ canActivate(ctx): boolean | Promise<boolean> }`. A `false`
  short-circuits with `403` and the handler never runs.
- **`SecurityAwareGuard`** — a `Guard` with
  `enforces: { scheme; scopes }`, used by OpenAPI generation.
- **`Pipe<In, Out>`** — `{ transform(value: In, ctx): Out | Promise<Out> }`.
  Transforms/validates the ctx body; an ordinary throw → `400`. A built-in
  boundary pipe may preserve a more specific framework status (multipart uses
  `400` for malformed framing and `413` for its limits).
- **`Interceptor`** — `{ intercept(ctx, next): Promise<unknown> }` where
  `next()` invokes the rest of the chain (the handler). Wraps pre/post.
- **`ExceptionFilter`** — `{ catch(error, ctx): WebResponse }`. Maps a thrown
  error to a response. If none matches, the pipeline's default (500) applies.

### Composition & order

A `Chain` composes them around a handler in this deterministic order:

1. **guards** (all must pass; first `false` → 403),
2. **pipes** (fold over the body, left→right),
3. **interceptors** (nest: `i0(i1(... handler ...))`, "before" then "after"),
4. **handler**,
5. on any throw, the first matching **exception filter** produces the response.

`runChain(chain, ctx, handler)` returns the produced value (or throws for the
pipeline to serialize). The router also runs the guard-only subset resolved from
`GuardRegistry.app`, `GuardRegistry.controllers[controllerName]`, then
`RouteOptions.guards`; complete chains remain explicit.

## Invariants

- Chain is built once (at register/compile time), executed per request with no
  reflection.
- **No `as`/`any`/`!` on the consumer surface.** Pipe in/out types compose so the
  handler body type follows from the pipes without assertions.

## Acceptance

- Guards run first and short-circuit (403) before pipes/handler; deterministic
  order (guard → pipe → interceptor-before → handler → interceptor-after).
- A pipe transforms the value seen by the handler; an ordinary throwing pipe →
  400, while multipart boundary/limit refusals preserve 400/413.
- An interceptor observes before + after and can alter the result.
- A thrown handler is mapped by a matching exception filter; unmatched → rethrow.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

Auto-wiring zmdb DTO validation as a pipe (epic #297), decorators to attach these
per-method (kept minimal here: chains are composed explicitly; method-decorator
sugar can follow).
