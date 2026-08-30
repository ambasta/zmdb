# SPEC — `zmdb` umbrella package (frozen)

Epic #225. A single install (`zmdb`) that re-exports the whole ecosystem so a new
user isn't assembling four packages. The four `@zmdb/*` packages remain
independently installable (tree-shaking / advanced use).

## Root re-export surface (curated)

The `zmdb` root (`import { … } from 'zmdb'`) re-exports the **curated public API**
of all four sub-packages. Frozen set:

- from `@zmdb/schema-core`: `defineSchema`, all column builders (`serial`,
  `integer`, `bigint`, `numeric`, `text`, `varchar`, `boolean`, `timestamp`,
  `json`, `jsonEnum`), the modifiers, and the derived types `Entity`, `CreateDTO`,
  `UpdateDTO` (types).
- from `@zmdb/query-compiler`: `createQueryCompiler` + `Dialect`, `CompiledQuery`
  (types).
- from `@zmdb/aot-validator`: `is`, `assert`, `validate`, `tags`.
- from `@zmdb/repository`: `BaseRepository`, `defineRepository`, `Driver` (type),
  `ValidationError`.

## Subpath re-exports

Deeper / advanced surfaces are re-exported under subpaths that mirror the source
packages, so nothing is lost:

- `zmdb/dto` → `@zmdb/schema-core/dto`
- `zmdb/relations` → `@zmdb/schema-core/relations`
- `zmdb/openapi`, `zmdb/seeding`, `zmdb/custom-types`, `zmdb/llm`
- `zmdb/drivers/sqlite`, `zmdb/drivers/pg`
- `zmdb/transactions`, `zmdb/replicas`, `zmdb/integrations`, `zmdb/entity-modeling`
- `zmdb/query` → `@zmdb/query-compiler` (+ `zmdb/query/joins`, `/aggregations`,
  `/fts`, `/migrations`, `/set-ops`, `/schema-objects`)
- `zmdb/validator` → `@zmdb/aot-validator` (+ `/advanced`, `/serialization`,
  `/utilities`, `/plugin`)

## No-collision guarantee

- The curated root names are unique across packages (verified by test). Where a
  name could collide (none today), the sub-package wins and the other is only
  reachable via its subpath. The re-export test asserts every promised name is
  present and identical (`===`) to the source export.

## Packaging (#228)

- New workspace `packages/zmdb`, `version` matching the others
  (`1.0.0-alpha.4`), `license: GPL-3.0-or-later`.
- `dependencies`: the four `@zmdb/*` packages at the same exact prerelease.
- Built with tsup (ESM `.js` + `.d.ts`); wired into `prepare-publish.mjs`,
  `repoint-dist.mjs`, and the `publish.yml` loop — published **last** (it depends
  on the others being on the registry).

## Acceptance
- Runtime test: every curated root export is present and `===` its source.
- Type-level: `import { defineSchema, BaseRepository } from 'zmdb'` type-checks
  and the types equal the source types.
