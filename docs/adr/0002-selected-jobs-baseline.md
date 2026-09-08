# 0002 — Selected-jobs packed baseline

**Status:** superseded

**Decision date:** Original capture at 961aaae0b0c9b4e29fc864f41454707933154a0e; preservation on 2026-09-08

**Owning issues:** #753, #756–#758; archival separation #737

## Context

The original packed journeys installed the old coupled jobs closure and exposed the old memory entry. The current selected providers have separate package ownership.

## Decision

Keep jobs explicitly selected, with portable behavior and provider-owned storage; preserve the original installation observations without presenting them as current facts.

## Evidence

The excerpts below are copied byte-for-byte from source commit `271a731e32be377343fe279070050d7ee6bd55a2`. Their original dates, commits, issue numbers, headings and measurements remain unchanged.
Statements inside the excerpts describe their recorded state.

## Consequences

The current provider manifests and contracts replace the former inventory and entry table. Default SQLite does not imply a jobs dependency or an automatic jobs provider.

## Current contract

[Jobs SPEC](../../packages/jobs/SPEC.md), [SQLite provider SPEC](../../packages/jobs-sqlite/SPEC.md), [PostgreSQL provider SPEC](../../packages/jobs-postgres/SPEC.md).

**Superseded by:** the current contracts linked above and their implementing issues.

## Preserved source excerpts

### 1. packages/jobs/SPEC.md — Opening #753 baseline status

Original source: `packages/jobs/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `e93e560e163cdc7d2e88a60d46dd0ef1b3efd8e77d8e914901a3e8a57c923473`.

```text
> **Selection and storage boundary frozen by issue #753 for epic #752.** This document separates the graph measured at commit `961aaae0b0c9b4e29fc864f41454707933154a0e` from the implementation target.
> Issue #753 changes no package manifest or runtime source.

```

### 2. packages/jobs/SPEC.md — §1 measured packed baseline

Original source: `packages/jobs/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `878c7d4f0088e1b24da7fe88f866759da727145546403fff38859ab28e9c67cf`.

```text
## 1. Measured packed baseline

The baseline was measured from packed `1.0.0-alpha.4` tarballs in clean, non-workspace Yarn 4.18.0 consumers on Node 26.8.1, Linux x64 GNU. Optional peers were not injected by the probe.

| Direct consumer dependency | Catalog packages in the installed production closure                                                                                                                            | Other installed packages                                                                                                              | Root import |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `zmdb`                     | `zmdb`, `@zmdb/ai`, `@zmdb/validator`, `@zmdb/app`, `@zmdb/migrations`, `@zmdb/sql`, `@zmdb/orm`, `@zmdb/schema`, `@zmdb/sqlite`, `@zmdb/web`                                   | `esbuild@0.28.2`, `@esbuild/linux-x64@0.28.2`, `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`                | exits 0     |
| `@zmdb/jobs`               | `@zmdb/ai`, `@zmdb/validator`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/migrations`, `@zmdb/sql`, `@zmdb/orm`, `@zmdb/schema`, `@zmdb/sqlite`                                          | `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`                                                               | exits 0     |
| `@zmdb/jobs-postgres`      | `@zmdb/ai`, `@zmdb/validator`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/jobs-postgres`, `@zmdb/migrations`, `@zmdb/postgres`, `@zmdb/sql`, `@zmdb/orm`, `@zmdb/schema`, `@zmdb/sqlite` | `oxfmt@0.66.0`, `@oxfmt/binding-linux-x64-gnu@0.66.0`, `tinypool@2.1.0`; `pg` is absent until the consumer installs the required peer | exits 0     |

The corresponding installed-package counts are 15, 12, and 14. The repository model at this commit contains 36 catalog packages and 69 direct non-development workspace edges.

```

### 3. packages/jobs/SPEC.md — §1 baseline selection and public-entry tables

Original source: `packages/jobs/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `e1f11987c5b504db4b28c4057d0d8f9b4b32c65a391c3888bc98e4c47cccf71e`.

```text
Every package relevant to the three journeys has one class:

| Package                                                          | Class                           | Baseline disposition                                                         |
| ---------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `zmdb`                                                           | default core                    | direct default install and product facade                                    |
| `@zmdb/schema`                                                   | default core                    | schema and DTO vocabulary                                                    |
| `@zmdb/sql`                                                      | default core                    | SQL vocabulary and compilation                                               |
| `@zmdb/validator`                                                | default core                    | validation and compiler-backed validation surface                            |
| `@zmdb/ai`                                                       | default core                    | current transitive implementation dependency of `@zmdb/validator`            |
| `@zmdb/orm`                                                      | default core                    | ORM and transaction contracts                                                |
| `@zmdb/app`                                                      | default core                    | application kernel                                                           |
| `@zmdb/web`                                                      | default core                    | HTTP framework                                                               |
| `@zmdb/sqlite`                                                   | concrete provider               | selected explicitly for the SQLite journey                                   |
| `@zmdb/migrations`, `esbuild`, `oxfmt`                           | development-only                | explicit migration, CLI, config, compiler, or formatting entries             |
| `@esbuild/linux-x64`, `@oxfmt/binding-linux-x64-gnu`, `tinypool` | private                         | non-catalog transitive implementation packages in these measured journeys    |
| `@zmdb/jobs`                                                     | selected first-party capability | currently also selects SQLite transitively; that coupling is removed by #756 |
| `@zmdb/jobs-sqlite`                                              | concrete provider               | target package; no manifest exists at this baseline                          |
| `@zmdb/jobs-postgres`                                            | concrete provider               | current PostgreSQL adapter                                                   |
| `@zmdb/postgres`, `pg`                                           | concrete provider               | PostgreSQL database package and its consumer-installed client peer           |

The current jobs-related public entries are:

| Entry                                                 | Current owner                                      | Class                              | Target                                             |
| ----------------------------------------------------- | -------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `@zmdb/jobs`                                          | `packages/jobs/src/index.ts`                       | selected first-party capability    | retain as the portable root                        |
| `@zmdb/jobs/schedule`                                 | `packages/jobs/src/schedule/index.ts`              | selected first-party capability    | retain                                             |
| `@zmdb/jobs/memory`                                   | `packages/jobs/src/queues/backends/memory.ts`      | concrete provider embedded in core | remove; migrate to `@zmdb/jobs-sqlite`             |
| `@zmdb/jobs-postgres`                                 | `packages/jobs-postgres/src/index.ts`              | concrete provider                  | retain and expand to the complete PostgreSQL store |
| `@zmdb/jobs-sqlite`                                   | absent                                             | concrete provider                  | add as one root-only package                       |
| `zmdb/jobs`, `zmdb/jobs/schedule`, `zmdb/jobs/memory` | absent from the current 16-entry `zmdb` export map | none                               | remain absent                                      |

```
