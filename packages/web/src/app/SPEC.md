# `@zmdb/web` — application bootstrap & lifecycle SPEC

> `createApp(RootModule, options?)` + lifecycle hooks + graceful shutdown
> (epic #292, extended by microservice transport slice #559).

## Contract

### `createApp(RootModule, options?: AppOptions): App`

- Compiles the module graph (via `compileModule`), builds a `Router`, and
  registers every module controller's routes on it — **once, at bootstrap**.
- Returns an `App`:
  - **`handle(req: WebRequest): Promise<WebResponse>`** — delegate to the router.
  - **`fetch(request: Request): Promise<Response>`** — the Fetch adapter.
  - **`container: Container`** — the resolved DI container.
  - **`lazy: readonly LazyModuleHandle[]`** — per-app handles for lazily
    imported modules; empty when the graph has none.
  - **`init(): Promise<void>`** — invoke lifecycle `onModuleInit` /
    `onApplicationBootstrap` hooks (in construction order) on every constructed
    provider/controller that implements them, then build the message dispatcher
    and open configured transports. Repeated calls share one initialization.
  - **`[Symbol.asyncDispose](): Promise<void>`** — invoke `onShutdown` hooks in
    reverse construction order; configured transports close first, in reverse
    declaration order, under the application grace bound.

`AppOptions` is declared by `../microservices/SPEC.md`: transports, the
dispatcher sinks/policy, and an optional positive `graceMs` whose default is
5,000 milliseconds.

### Lifecycle hook interfaces

- **`OnModuleInit`** — `{ onModuleInit(): void | Promise<void> }`.
- **`OnApplicationBootstrap`** — `{ onApplicationBootstrap(): void | Promise<void> }`.
- **`OnShutdown`** — `{ onShutdown(): void | Promise<void> }`.

### Order

- A `useValue` provider enters the lifecycle ledger when it is registered. A
  `useFactory` provider enters only after its factory actually returns, and a
  controller enters after construction. Object identity is recorded once.
- `init()`: `onModuleInit` (all constructed instances, deps-first), then
  `onApplicationBootstrap` (all), then dispatcher construction, then
  `transport.listen` in declaration order.
- A rejected `listen` rejects initialization and closes transports that opened
  earlier. No HTTP-only degraded mode is invented.
- A factory first resolved after `init()` does not receive retroactive init
  hooks, but it does enter the ledger and receives shutdown. An unresolved
  factory is never constructed merely to run a hook.
- shutdown: stop new lazy loads, await in-flight loads, close transports in
  reverse declaration order, then run `onShutdown` in **reverse construction
  order**, so no message handler outlives a dependency it resolved.
- Once shutdown begins, a later `init()` rejects instead of opening resources
  after the memoized disposal has finished.

## Invariants

- Routes and every module declaration are wired/validated **at bootstrap**.
  Eager instances are constructed there; lazy subtrees are constructed on
  first use. The per-request path performs **no reflection.**
- **No `as`/`any`/`!` on the consumer surface.** Hook detection uses typed
  `in`-narrowing (structural), not casts.
- Uses Stage-3 `Symbol.asyncDispose` for `await using` graceful shutdown.
- Message consumers are eager. A lazy controller with message-pattern metadata
  is rejected because a startup-built closed dispatch map cannot discover it
  later without changing its cost model.

## Acceptance

- `createApp(Root)` handles a request routed to a module controller (200).
- `init()` calls `onModuleInit`/`onApplicationBootstrap` on constructed
  provider/controller implementers, in order; `await using` (dispose) calls
  `onShutdown` in reverse construction order.
- A constructed lazy provider is shut down; an unresolved provider factory is
  neither constructed nor shut down.
- Transport startup follows bootstrap hooks; partial startup closes what
  opened, and disposal closes transports before lifecycle hooks.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

WS/SSE gateways (epic #307), testing harness (#312), concrete broker and gRPC
adapters (#560–#561).
