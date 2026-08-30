# `@zmdb/web` — application bootstrap & lifecycle SPEC

> `createApp(RootModule)` + lifecycle hooks + graceful shutdown (epic #292).
> Frozen before code.

## Contract

### `createApp(RootModule): App`
- Compiles the module graph (via `compileModule`), builds a `Router`, and
  registers every module controller's routes on it — **once, at bootstrap**.
- Returns an `App`:
  - **`handle(req: WebRequest): Promise<WebResponse>`** — delegate to the router.
  - **`fetch(request: Request): Promise<Response>`** — the Fetch adapter.
  - **`container: Container`** — the resolved DI container.
  - **`init(): Promise<void>`** — invoke lifecycle `onModuleInit` /
    `onApplicationBootstrap` hooks (in module-graph order) on any provider/
    controller that implements them.
  - **`[Symbol.asyncDispose](): Promise<void>`** — invoke `onShutdown` hooks in
    reverse order; enables `await using app = createApp(...)`.

### Lifecycle hook interfaces
- **`OnModuleInit`** — `{ onModuleInit(): void | Promise<void> }`.
- **`OnApplicationBootstrap`** — `{ onApplicationBootstrap(): void | Promise<void> }`.
- **`OnShutdown`** — `{ onShutdown(): void | Promise<void> }`.

### Order
- `init()`: `onModuleInit` (all, deps-first) then `onApplicationBootstrap` (all).
- shutdown: `onShutdown` in **reverse** registration order.

## Invariants
- Everything (DI graph, routes) wired **at bootstrap**; the per-request path is
  the W6 dispatcher unchanged — **no reflection per request.**
- **No `as`/`any`/`!` on the consumer surface.** Hook detection uses typed
  `in`-narrowing (structural), not casts.
- Uses Stage-3 `Symbol.asyncDispose` for `await using` graceful shutdown.

## Acceptance
- `createApp(Root)` handles a request routed to a module controller (200).
- `init()` calls `onModuleInit`/`onApplicationBootstrap` on implementers, in
  order; `await using` (dispose) calls `onShutdown` in reverse.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope
WS/SSE gateways (epic #307), testing harness (#312).
