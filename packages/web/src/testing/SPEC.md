# `@zmdb/web` — testing utilities SPEC

> `createTestApp` with DI overrides + in-process request driving (epic #312).
> Frozen. The `@nestjs/testing` analogue.

## Contract

### `createTestApp(rootModule, { overrides? })`

- Compiles the module graph like `createApp`, but **applies provider overrides
  first**: `overrides` is a list of `{ token, useValue }` (or `{ token,
useFactory }`) that replace a provider before controllers are built — so a
  controller under test injects the stub.
- Returns a `TestApp`:
  - **`request(req: WebRequest): Promise<WebResponse>`** — drive a route
    in-process (no socket), same pipeline as production.
  - **`get<T>(token): T`** — resolve any provider (e.g. to assert on a spy).
  - **`init()` / `[Symbol.asyncDispose]()`** — lifecycle, same as `App`.

## Invariants

- Overrides are applied **before** controllers are built, through the same
  Container — the override is what gets injected.
- In-process: `request` uses the router's `handle` — no network.
- **No `as`/`any`/`!` on the consumer surface.**

## Acceptance

- A controller built by `createTestApp` with an overridden provider uses the
  **stub** (verified via `request` + `get`).
- `request` routes to a controller (200) with no server.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

Assertion library / matchers (use the project's vitest).
