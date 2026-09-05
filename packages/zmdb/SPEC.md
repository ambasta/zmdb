# SPEC — `zmdb` umbrella package (frozen)

Epic #225. A single install (`zmdb`) that re-exports the whole ecosystem so a new user isn't assembling four packages. The four `@zmdb/*` packages remain independently installable (tree-shaking /
advanced use).

## Root re-export surface (curated)

The `zmdb` root (`import { … } from 'zmdb'`) re-exports the **curated public API** of all four sub-packages. Frozen set:

- from `@zmdb/schema-core`: `schemaOf`, the entity state machine (`defineStateTransitions`, `defineEntityStateMachine`, `createStateUpdatePayload`), and the derived types `Entity`, `CreateDTO`,
  `UpdateDTO` (types). The tag vocabulary a table is declared in lives at the `zmdb/tags` subpath, and the derivations that read a declared type at `zmdb/derive`, since both are types-only and a value
  import of either is a mistake worth making awkward.

  This list used to open with `defineSchema` and ten column builders. They were deleted (plan D2) — a table is declared as a type now — and `verify:no-defineschema` imports this very surface to check
  they have not come back, which is the one check a grep could not make: a builder re-exported here without being declared here would still be published.

- from `@zmdb/query-compiler`: `createQueryCompiler` + `Dialect`, `CompiledQuery` (types).
- from `@zmdb/aot-validator`: `is`, `assert`, `validate`, `tags`.
- from `@zmdb/repository`: `BaseRepository`, `defineRepository`, `Driver` (type), `ValidationError`.

## Subpath re-exports

Deeper / advanced surfaces are re-exported under subpaths that mirror the source packages, so nothing is lost:

- `zmdb/dto` → `@zmdb/schema-core/dto`
- `zmdb/relations` → `@zmdb/schema-core/relations`
- `zmdb/openapi`, `zmdb/seeding`, `zmdb/custom-types`, `zmdb/llm`
- `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, `zmdb/drivers/mssql`
- `zmdb/transactions`, `zmdb/replicas`, `zmdb/integrations`, `zmdb/entity-modeling`
- `zmdb/query` → `@zmdb/query-compiler` (+ `zmdb/query/joins`, `/aggregations`, `/fts`, `/migrations`, `/set-ops`, `/schema-objects`)
- `zmdb/validator` → `@zmdb/aot-validator` (+ `/advanced`, `/serialization`, `/utilities`, `/plugin`)

## The two subpaths that are not re-exports

`zmdb/cli` and `zmdb/config` are the executable and its config schema, specified in `src/cli/SPEC.md` and `src/config/SPEC.md`. They break the pattern above twice, deliberately: they are written here
rather than re-exported from somewhere else, and the package acquires a `bin`.

The reason a facade hosts them is that `npx zmdb generate` is the command a user will type, and the only alternative is a second published package whose entire content is an executable. This package
already depends on every other one, so the CLI reaches the reflector, the compiler and the migration runner without a new dependency edge — which is the same property that makes the facade the right
host and would make any other choice add one.

Both join `BUILD_TIME_ENTRIES` in `.github/scripts/verify-exports.mjs`, beside `zmdb#./unplugin`. That is what keeps a compiler session and a filesystem walk out of an application bundle, and it is
the reason the no-collision guarantee below does not extend to them: nothing in either subpath is reachable from the root.

## No-collision guarantee

- The curated root names are unique across packages (verified by test). Where a name could collide (none today), the sub-package wins and the other is only reachable via its subpath. The re-export
  test asserts every promised name is present and identical (`===`) to the source export.

## Packaging (#228)

- New workspace `packages/zmdb`, `version` matching the others (`1.0.0-alpha.4`), `license: GPL-3.0-or-later`.
- `dependencies`: every other `@zmdb/*` package — five of them, `@zmdb/web` included since the `zmdb/web` subpath landed — at the same exact prerelease.
- Built by `scripts/build-package.mjs` (`tsc` → ESM `.js` + `.d.ts` mirroring `src`); wired into `prepare-publish.mjs`, `lib/publish-manifest.mjs`'s package order, and `publish.yml` — published
  **last** (it depends on the others being on the registry). The `publish.yml` loop it was originally wired into addressed every workspace as `@zmdb/$pkg`, so the umbrella — named plainly `zmdb` — was
  never actually built by it; `yarn build` covers every workspace instead.

## Acceptance

- Runtime test: every curated root export is present and `===` its source.
- Type-level: `import { schemaOf, BaseRepository } from 'zmdb'` type-checks and the types equal the source types.
