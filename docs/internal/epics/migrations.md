# [EPIC] Migrations & Schema Diffing

## Goal

Generate SQL migrations directly from the single-source-of-truth schema, comparable to mikro-orm's migrator + schema generator. Because the schema is the source of truth, the migration engine diffs
the declared schema against the current DB (or previous snapshot) and emits forward/backward SQL.

## Parity Reference

- **mikro-orm**: `SchemaGenerator`, `Migrator`, `create/up/down`, diffing.

## Adopted (aligned with our architecture)

- Snapshot the compiled schema metadata to a deterministic artifact.
- Diff engine: previous snapshot vs current schema → up/down SQL.
- CLI: `zmdb migrate create`, `migrate up`, `migrate down`, `migrate status`.
- Dialect-aware DDL emission (Postgres/MySQL/SQLite) via `@zmdb/query-compiler` dialects.

## Explicitly Rejected (anti-patterns for us)

- ❌ Runtime auto-`updateSchema()` against production (destructive, implicit).
- ❌ Reflection-based entity discovery — schema registry is explicit/compile-time.

## Definition of Done

Fully resolved when all sub-issues are closed. Sub-issues collectively deliver:

1. Frozen spec for snapshot format + migration lifecycle.
2. Schema snapshot serializer.
3. Diff engine (snapshot → snapshot).
4. DDL emitter per dialect.
5. Migration runner + CLI + version tracking table.

## Constraints

- Migrations are plain SQL files, human-reviewable.
- Deterministic output (stable ordering).
- ESM-only, Node 26+, TypeScript 7.0+.

Sub-issues linked below as a task list.
