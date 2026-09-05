# `@zmdb/web` — application bootstrap & lifecycle SPEC

> `createApp(RootModule, options?)` + lifecycle hooks + graceful shutdown (epic #292, extended by microservice transport slice #559).

## Contract

### `createApp(RootModule, options?: AppOptions): App`

- Compiles the module graph (via `compileModule`), builds a `Router`, and registers every module controller's routes on it — **once, at bootstrap**.
- Returns an `App`:
  - **`handle(req: WebRequest): Promise<WebResponse>`** — delegate to the router.
  - **`fetch(request: Request): Promise<Response>`** — the Fetch adapter.
  - **`container: Container`** — the resolved DI container.
  - **`lazy: readonly LazyModuleHandle[]`** — per-app handles for lazily imported modules; empty when the graph has none.
  - **`init(): Promise<void>`** — invoke lifecycle `onModuleInit` / `onApplicationBootstrap` hooks (in construction order) on every constructed provider/controller/command that implements them, then
    build the message dispatcher, open configured broker transports and bind the optional gRPC server through the opener registered by the explicit gRPC subpath. Repeated calls share one
    initialization.
  - **`[Symbol.asyncDispose](): Promise<void>`** — invoke `onShutdown` hooks in reverse construction order; the gRPC server and configured transports close first under the application grace bound.

`AppOptions` is declared by `../microservices/SPEC.md`: transports, the dispatcher sinks/policy, observability, optional gRPC server options, and an optional positive `graceMs` whose default is 5,000
milliseconds.

### Lifecycle hook interfaces

- **`OnModuleInit`** — `{ onModuleInit(): void | Promise<void> }`.
- **`OnApplicationBootstrap`** — `{ onApplicationBootstrap(): void | Promise<void> }`.
- **`OnShutdown`** — `{ onShutdown(): void | Promise<void> }`.

### Order

- A `useValue` provider enters the lifecycle ledger when it is registered. A `useFactory` provider enters only after its factory actually returns, and a controller or command enters after
  construction. Object identity is recorded once.
- `init()`: `onModuleInit` (all constructed instances, deps-first), then `onApplicationBootstrap` (all), dispatcher construction, `transport.listen` in declaration order, then the optional gRPC bind.
- A rejected `listen` or gRPC bind rejects initialization and closes broker transports that opened earlier. No HTTP-only degraded mode is invented.
- A factory first resolved after `init()` does not receive retroactive init hooks, but it does enter the ledger and receives shutdown. An unresolved factory is never constructed merely to run a hook.
- shutdown: stop new lazy loads, await in-flight loads, close gRPC, close broker transports in reverse declaration order, then run `onShutdown` in **reverse construction order**, so no handler
  outlives a dependency it resolved.
- Once shutdown begins, a later `init()` rejects instead of opening resources after the memoized disposal has finished.

## Invariants

- Routes and every module declaration are wired/validated **at bootstrap**. Eager instances are constructed there; lazy subtrees are constructed on first use. The per-request path performs **no
  reflection.**
- **No `as`/`any`/`!` on the consumer surface.** Hook detection uses typed `in`-narrowing (structural), not casts.
- Uses Stage-3 `Symbol.asyncDispose` for `await using` graceful shutdown.
- Message consumers are eager. A lazy controller with message-pattern metadata is rejected because a startup-built closed dispatch map cannot discover it later without changing its cost model.

## Acceptance

- `createApp(Root)` handles a request routed to a module controller (200).
- `init()` calls `onModuleInit`/`onApplicationBootstrap` on constructed provider/controller/command implementers, in order; `await using` (dispose) calls `onShutdown` in reverse construction order.
- A constructed lazy provider is shut down; an unresolved provider factory is neither constructed nor shut down.
- Transport startup follows bootstrap hooks; partial startup closes what opened, and disposal closes transports before lifecycle hooks.
- A public-only custom strategy stops intake, drains work accepted before shutdown under `graceMs`, and closes its connection before lifecycle hooks.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

The host HTTP listening socket, process signal handling and unrelated protocol adapters remain outside this lifecycle contract.

## Package ownership amendment (#645)

The lifecycle above splits without changing its observable ordering:

- graph compilation, constructed-instance hooks, extension startup/rollback/shutdown and the total grace budget move to `@zmdb/app/lifecycle`;
- `createApplication` returns the protocol-neutral `Application`;
- HTTP route registration, `handle`, `fetch` and the name `createApp` remain in `@zmdb/web/app`;
- broker and gRPC startup are supplied as `ApplicationExtension` values by app/optional packages rather than fields on `AppOptions`.

`App` becomes `WebApplication`; `AppOptions` is deleted in favour of `ApplicationOptions` and `WebApplicationOptions`. No aliases remain.

`createApp` composes one router over one `Application`. Its `container`, `lazy`, `init` and async-dispose members are the same members by identity, and it cannot run a second hook/extension ledger.
The complete lifecycle state machine, rollback and error precedence are frozen in `packages/app/SPEC.md`.

The #647 extraction is the independently usable first slice: it retains the `App` compatibility type and the broker/gRPC fields inherited from `AppOptions` until #648 and #649 move those integrations
and complete the HTTP-only surface. Those transitional names delegate to `createApplication`; they do not retain a second lifecycle implementation.
