# [EPIC] JSON Schema / OpenAPI Generation

## Goal

Generate JSON Schema and OpenAPI documents **deterministically at build time** from the single-source-of-truth schema — the same `defineSchema` metadata that already drives Entity/CreateDTO/UpdateDTO,
validation tags, relations, and migrations. No runtime reflection; the generated documents are artifacts, not live objects.

## Parity Reference

- **typia**: `typia.json.schema<T>()` / application schema generation from types.
- **zod**: ecosystem `zod-to-openapi` (we do it from the schema DSL instead).

## Adopted (aligned with our architecture)

- `toJsonSchema(schema)` → JSON Schema (draft 2020-12) object for a table's `Entity`.
- DTO-aware generation: request bodies use `CreateDTO`/`UpdateDTO`, responses use `Entity`.
- Validation tags map to JSON Schema keywords: `Min→minimum`, `Max→maximum`, `MinLength/MaxLength→minLength/maxLength`, `Pattern→pattern`, `Enum→enum`.
- Relations map to `$ref`/`items:{$ref}` component references.
- `toOpenApiComponents([...schemas])` → `components.schemas` map for an OpenAPI 3.1 doc.
- Deterministic, stable output (sorted keys) suitable for committing/diffing.

## Explicitly Rejected (anti-patterns for us)

- ❌ Runtime reflection / decorator metadata scanning to build schemas.
- ❌ Emitting schemas from a live server introspection pass.
- ❌ Divergent hand-written OpenAPI that can drift from the source schema.

## Definition of Done

Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:

1. Frozen spec: JSON Schema mapping table + OpenAPI component contract + determinism rules.
2. `toJsonSchema` for scalar/enum/nullable columns.
3. Validation-tag → JSON Schema keyword mapping.
4. DTO-aware generation (CreateDTO/UpdateDTO vs Entity) + relation `$ref`s.
5. `toOpenApiComponents` aggregation + determinism + E2E golden document.

## Constraints

- Build-time generation only; no runtime reflection.
- Draft 2020-12 JSON Schema / OpenAPI 3.1.
- Deterministic (stable key ordering).
- ESM-only, Node 26+, TypeScript 7.0+.

Lives in `@zmdb/schema-core` (module `src/openapi/`). Sub-issues linked below.
