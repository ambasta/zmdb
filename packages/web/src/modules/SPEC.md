# `@zmdb/web` — modules & providers SPEC

> `@Module` + a provider graph over the DI Container (epic #282). Frozen before
> code.

## Contract

### `@Module({ controllers?, providers?, imports?, exports? })`

A Stage-3 **class** decorator recording a module definition in `context.metadata`:

- **`providers`**: `readonly ProviderDef[]` — each `{ token, useValue }` (a bound
  value) or `{ token, useFactory }` (a factory `(c: Container) => T`), optionally
  `{ scope: 'singleton' | 'transient' }` (default `singleton`).
- **`controllers`**: `readonly Constructor[]` built through the container.
- **`imports`**: other `@Module` classes whose **exports** are visible here.
- **`exports`**: subset of this module's tokens visible to importers.

### `compileModule(RootModuleClass): CompiledModule`

Walk the module graph (acyclic) and:

- create a `Container`, register every module's providers (respecting `imports`/
  `exports` visibility), resolving `useFactory` lazily,
- build each module's controllers through the container,
- expose `{ container, controllers }`.
- **Singleton** providers resolve once and cache; **transient** re-run the factory
  on each `resolve`. Detect and throw on an **import cycle**.

## Invariants

- Static wiring at compile time (module-graph walk), cached — **no per-request
  graph walk, no reflection.**
- **No `as`/`any`/`!` on the consumer surface.** Provider token typing carries T.
- Builds on `@zmdb/web/di` — the Container remains the single registry.

## Acceptance

- A root module with providers + controllers + an imported module compiles: its
  controllers are built and their injected providers resolve (incl. from imports
  it exports).
- A transient provider yields a fresh value per resolve; a singleton is cached.
- An import cycle throws.
- No consumer-surface `as`; suite + typecheck green.

## Out of scope

App bootstrap/lifecycle (epic #292), guards/pipes (#287).
