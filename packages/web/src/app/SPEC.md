# `@zmdb/web/app` — HTTP application composition SPEC

> `createApp(RootModule, options?)` composes one startup-built HTTP router over the `@zmdb/app` lifecycle (epic #292, ownership amended by #647–#649).

## Contract

### `createApp(RootModule, options?: WebApplicationOptions): WebApplication`

- Compiles the module graph (via `compileModule`), builds a `Router`, and registers every module controller's routes on it — **once, at bootstrap**.
- Returns a `WebApplication`:
  - **`handle(req: WebRequest): Promise<WebResponse>`** — delegate to the router.
  - **`fetch(request: Request): Promise<Response>`** — the Fetch adapter.
  - **`container: Container`** — the resolved DI container.
  - **`lazy: readonly LazyModuleHandle[]`** — per-app handles for lazily imported modules; empty when the graph has none.
  - **`init(): Promise<void>`** — delegate to the app-owned lifecycle, which invokes hooks and explicit application extensions. Repeated calls share one initialization.
  - **`[Symbol.asyncDispose](): Promise<void>`** — delegate to the app-owned bounded extension shutdown and reverse construction-order hooks.

`WebApplicationOptions` extends `ApplicationOptions` only with the router's guard registry and versioning strategy. Message transports attach with `transportExtension(...)` from `@zmdb/app/messaging`;
gRPC attaches with `grpcExtension(...)` from `@zmdb/transport-grpc`. Web options contain no protocol-specific transport fields.

### Lifecycle hook interfaces

- **`OnModuleInit`** — `{ onModuleInit(): void | Promise<void> }`.
- **`OnApplicationBootstrap`** — `{ onApplicationBootstrap(): void | Promise<void> }`.
- **`OnShutdown`** — `{ onShutdown(): void | Promise<void> }`.

### Order

- A `useValue` provider enters the lifecycle ledger when it is registered. A `useFactory` provider enters only after its factory actually returns, and a controller or command enters after
  construction. Object identity is recorded once.
- `init()`: `onModuleInit` (all constructed instances, deps-first), then `onApplicationBootstrap` (all), then explicit application extensions in declaration order.
- A rejected extension start rejects initialization and rolls back entered extensions. No HTTP-only degraded mode is invented.
- A factory first resolved after `init()` does not receive retroactive init hooks, but it does enter the ledger and receives shutdown. An unresolved factory is never constructed merely to run a hook.
- shutdown: stop new lazy loads, await in-flight loads, stop explicit extensions in reverse declaration order, then run `onShutdown` in **reverse construction order**, so no handler outlives a
  dependency it resolved.
- Once shutdown begins, a later `init()` rejects instead of opening resources after the memoized disposal has finished.

## Invariants

- Routes and every module declaration are wired/validated **at bootstrap**. Eager instances are constructed there; lazy subtrees are constructed on first use. The per-request path performs **no
  reflection.**
- **No `as`/`any`/`!` on the consumer surface.** Hook detection uses typed `in`-narrowing (structural), not casts.
- Uses Stage-3 `Symbol.asyncDispose` for `await using` graceful shutdown.
- Messaging owns its eager-consumer rule in `../../../app/src/messaging/SPEC.md`; HTTP route laziness remains unchanged.

## Acceptance

- `createApp(Root)` handles a request routed to a module controller (200).
- `init()` calls `onModuleInit`/`onApplicationBootstrap` on constructed provider/controller/command implementers, in order; `await using` (dispose) calls `onShutdown` in reverse construction order.
- A constructed lazy provider is shut down; an unresolved provider factory is neither constructed nor shut down.
- Explicit extension startup follows bootstrap hooks; partial startup rolls back what entered, and disposal stops extensions before lifecycle hooks.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

The host HTTP listening socket, process signal handling and unrelated protocol adapters remain outside this lifecycle contract.

## Package ownership amendment (#645)

The lifecycle above splits without changing its observable ordering:

- graph compilation, constructed-instance hooks, extension startup/rollback/shutdown and the total grace budget move to `@zmdb/app/lifecycle`;
- `createApplication` returns the protocol-neutral `Application`;
- HTTP route registration, `handle`, `fetch` and the name `createApp` remain in `@zmdb/web/app`;
- broker startup and gRPC startup are supplied as `ApplicationExtension` values by their owning packages.

`WebApplication` is the public shape. `App` and `AppOptions` are deleted rather than retained as aliases; `ApplicationOptions` and `WebApplicationOptions` carry the app-owned and HTTP-owned options.

`createApp` composes one router over one `Application`. Its `container`, `lazy`, `init` and async-dispose members are the same members by identity, and it cannot run a second hook/extension ledger.
The complete lifecycle state machine, rollback and error precedence are frozen in `packages/app/SPEC.md`.

The #647 extraction supplied the app-owned lifecycle. #648 moved broker fields behind `transportExtension`, #657 moved gRPC behind `grpcExtension`, and #649 removes the final compatibility name
without changing the one-call `createApp` composition.
