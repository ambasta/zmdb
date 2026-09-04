# `@zmdb/web` — SPEC

> Stage-3 decorator web framework for the zmdb ecosystem. This SPEC freezes the
> **package baseline** (issue #248, epic #247). Later concerns (routing, Ctx, DI,
> state machines, pipeline, …) get their own `src/<concern>/SPEC.md`.

## Position in the architecture

`@zmdb/web` sits **above** `@zmdb/repository` in the dependency DAG
(ARCHITECTURE.md §3). It depends on `@zmdb/schema-core`, `@zmdb/aot-validator`,
`@zmdb/query-compiler` and `@zmdb/repository`; it has **zero required
third-party runtime dependencies**. Integrations such as `pg` and
`@opentelemetry/api` are optional peers.

## Invariants (inherited, non-negotiable)

1. **No `as` / no `any` / no `!` on the consumer surface.** Framework internals
   hold to the documented, shrinking boundary-cast exception list (ARCHITECTURE.md
   §2.1). A user must never need an assertion to use `@zmdb/web`.
2. **No runtime reflection.** No `reflect-metadata`, no `emitDecoratorMetadata`.
   Decorators use **Stage 3** semantics and store data only in `context.metadata`
   (`Symbol.metadata`).
3. **Stage 3 decorators**: tsconfig sets `experimentalDecorators: false` and must
   compile standard decorators. `Symbol.metadata` is **not yet exposed by Node 26
   / V8** (`Symbol.metadata === undefined` as of v26.8), so a zero-dependency
   polyfill installs the well-known symbol when absent (a no-op once a runtime
   ships it natively). It assigns only `Symbol.metadata` and mutates no other
   global, and is imported for its side effect before any decorated class is
   evaluated.
4. **ESM-only, Node 26+, TS 7+.** `"type": "module"`, single `exports` map, no CJS.

## Baseline contract (this issue)

### Package

- New workspace `packages/web`, name **`@zmdb/web`**, version tracks the other
  packages (`1.0.0-alpha.4`), license **GPL-3.0-or-later**.
- `dependencies`: `@zmdb/schema-core`, `@zmdb/aot-validator`,
  `@zmdb/query-compiler`, `@zmdb/repository` (all `workspace:^`). No required
  third-party runtime deps; `pg` and `@opentelemetry/api` are optional peers for
  their respective integration subpaths.
- `exports."."` → `./src/index.ts` (repointed to `./dist/index.js` at publish,
  exactly like the sibling packages).

### tsconfig

- Extends `../../tsconfig.json`.
- `rootDir`, `outDir` and the sibling `.d.ts` `paths` live in `tsconfig.build.json`,
  the emit project; `tsconfig.json` is `noEmit` and resolves siblings to their
  sources, so an edit in one package is a compile error here immediately.
- Explicitly asserts the decorator baseline: `experimentalDecorators: false`,
  `emitDecoratorMetadata: false`. (`strict` etc. come from base.)

### Build & publish wiring

- `tsconfig.build.json` mirrors `src` into `dist`; every public root and subpath
  is declared in the package `exports` map and repointed to emitted `.js` during
  publishing.
- Registered in `.github/scripts/prepare-publish.mjs` `META` (description +
  keywords) and in `.github/scripts/lib/publish-manifest.mjs` `PACKAGES`, ordered
  **after `repository`** and **before `zmdb`** (DAG order).
- Re-exported from the `zmdb` umbrella as **`zmdb/web`** (a new subpath entry in
  `packages/zmdb`).

### Baseline symbol

- A zero-dependency **`Symbol.metadata` polyfill** (`src/polyfill.ts`), imported
  first by the entry, installing the well-known symbol when the runtime lacks it.
- `metadataOf(target)` — a tiny, typed accessor that reads the Stage-3
  `Symbol.metadata` record off a decorated class/prototype and returns a
  `DecoratorMetadata` object (never `undefined`; returns an empty frozen record
  when absent). This is the one primitive every later decorator builds on, and it
  proves the baseline round-trips through the build.

## Acceptance (this issue)

- `@zmdb/web` resolves in dev (vitest/tsc) via `src` and builds to
  `dist/index.js` + `dist/index.d.ts`; every declared subpath imports and
  typechecks from an installed tarball (`yarn verify:publish`).
- A trivial Stage-3 class decorator that writes to `context.metadata` can be read
  back via `metadataOf(...)` at runtime — **without** `reflect-metadata` and
  **without** any `as` on the consumer surface.
- `zmdb/web` re-export path is present and re-exports the package root.
- Full monorepo suite + typecheck stay green.

## Out of scope (future issues/epics)

Routing (#252), typed `Ctx`/path-params (#257), DI (#262), domain state machines
(#267), request pipeline/adapters (#272), data-layer integration (#277), and all
NestJS-parity follow-ups (#282–#321). Those freeze their own SPECs.
