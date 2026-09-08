# Runtime foundation boundary policy — issues #635, #636 and #638

This is the normative contract enforced by `.github/scripts/verify-runtime-foundation.mjs`. The four final packages are independent runtime owners; all four superseded package identities are removed.

## 1. Measured input inventory

The source inventory includes TypeScript implementation and retained test-support files, excluding `*.spec.ts`, `*.type-test.ts` and test-owned `__generated__`/`__budget__` scratch directories. The
four build configurations explicitly exclude the 14 retained test supports, and package archives exclude them.

| Package           | Inventoried source files | Build implementation files | Public entries |
| ----------------- | -----------------------: | -------------------------: | -------------: |
| `@zmdb/schema`    |                       17 |                         13 |             10 |
| `@zmdb/sql`       |                       23 |                         19 |              7 |
| `@zmdb/validator` |                        7 |                          7 |              4 |
| `@zmdb/orm`       |                       20 |                         14 |              8 |

There are 67 inventoried TypeScript files and 53 implementation files in these four packages. Schema and SQL have no production dependencies. Validator depends only on schema; ORM depends exactly on
schema, SQL and validator. Database packages retain their existing inward foundation edges and their migrations lifecycle edge.

## 2. Exact file ownership

The verifier compares each current source path with this inventory and refuses omitted, duplicate or absent paths. Retained test supports remain visible in this inventory even though they are excluded
from builds and archives.

### `@zmdb/schema` — 17

```text
packages/schema/src/custom-types/index.ts
packages/schema/src/derive/__testing__/instantiations.ts
packages/schema/src/derive/index.ts
packages/schema/src/derive/query.ts
packages/schema/src/dto/fixtures.ts
packages/schema/src/dto/index.ts
packages/schema/src/entity-modeling/index.ts
packages/schema/src/index.ts
packages/schema/src/ir/index.ts
packages/schema/src/ir/validation-shape.ts
packages/schema/src/ir/vocabulary.ts
packages/schema/src/naming/index.ts
packages/schema/src/openapi/index.ts
packages/schema/src/relations/fixtures.ts
packages/schema/src/relations/index.ts
packages/schema/src/tags/__fixtures__/duplicate-copy.ts
packages/schema/src/tags/index.ts
```

### `@zmdb/sql` — 23

```text
packages/sql/src/aggregations/index.ts
packages/sql/src/clauses.ts
packages/sql/src/comments/index.ts
packages/sql/src/compiled-query.ts
packages/sql/src/dialects/index.ts
packages/sql/src/dialects/protocol.ts
packages/sql/src/errors.ts
packages/sql/src/expressions/index.ts
packages/sql/src/extensions/index.ts
packages/sql/src/fts/index.ts
packages/sql/src/index.ts
packages/sql/src/introspect/types.ts
packages/sql/src/joins/index.ts
packages/sql/src/migrations/types.ts
packages/sql/src/quoting.ts
packages/sql/src/schema-objects/extensions.ts
packages/sql/src/schema-objects/index.ts
packages/sql/src/schema-objects/types.ts
packages/sql/src/set-ops/index.ts
packages/sql/src/testing/capability-matrix.ts
packages/sql/src/testing/database-vertical.ts
packages/sql/src/testing/external-dialect.fixture.ts
packages/sql/src/testing/official-dialects.fixture.ts
```

### `@zmdb/validator` — 7

```text
packages/validator/src/advanced/index.ts
packages/validator/src/errors.ts
packages/validator/src/index.ts
packages/validator/src/regex-complexity.ts
packages/validator/src/serialization/index.ts
packages/validator/src/utilities/index.ts
packages/validator/src/validation-error.ts
```

### `@zmdb/orm` — 20

```text
packages/orm/src/cache/index.ts
packages/orm/src/drivers/transactional.ts
packages/orm/src/dto/index.ts
packages/orm/src/dx/fixtures.ts
packages/orm/src/entity-modeling/index.ts
packages/orm/src/filters/index.ts
packages/orm/src/index.ts
packages/orm/src/loaders/index.ts
packages/orm/src/orders-fixture.ts
packages/orm/src/outbox/index.ts
packages/orm/src/outbox/sql.ts
packages/orm/src/relations/index.ts
packages/orm/src/replicas/index.ts
packages/orm/src/seeding/index.ts
packages/orm/src/streaming/index.ts
packages/orm/src/testing/official-dialects.fixture.ts
packages/orm/src/transactions/index.ts
packages/orm/src/transactions/recording-conn.ts
packages/orm/src/typed-methods/typed-methods.fixture.ts
packages/orm/src/typed-populate/fixtures.ts
```

## 3. Mixed-file symbol seams

A file-level map is insufficient where one current barrel or module exports two concerns. These seams are exhaustive:

| Current file                                 | Stays with its file owner                                                                                               | Extracted owner                                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema-core/src/index.ts`                   | schema declarations, schema values, derivation types, `isRecord`, type-test helpers                                     | `ValidationIssue`, `ValidationError`, `claimsValidationIssues`, and `validationIssuesOf` → `@zmdb/validator`; SQL/populate and SQL/DTO root re-exports → `@zmdb/orm`; state-transition/state-machine symbols → `@zmdb/app` |
| `schema-core/src/dto/index.ts`               | DTO/result types, cursor encoding, projection, `getResult`, `buildListResult`, `buildSearchResult`, `describeAggregate` | `WhereTarget`, `OrderTarget`, `compileWhere`, `applyOrderBy`, `applyKeysetFilter`, and `applyPagination` → `@zmdb/orm/dto`                                                                                                 |
| `schema-core/src/relations/index.ts`         | `ResolvedRelation` and `resolveRelation`                                                                                | `PopulateDialect`, `PopulateQuery`, `compilePopulate`, `attachPopulated`, `JoinRow`, and `aliasRow` → `@zmdb/orm/relations`                                                                                                |
| `query-compiler/src/dialects/index.ts`       | temporary six-dialect registry composition, compatibility name dispatch, and capability refusal helper                  | official dialect records and name dispatch → database packages when #665 lands                                                                                                                                             |
| `query-compiler/src/dialects/protocol.ts`    | generic dialect protocol/types and construction validation                                                              | none; this zero-vendor-name protocol stays in `@zmdb/sql`                                                                                                                                                                  |
| `query-compiler/src/schema-objects/index.ts` | runtime schema-object SQL                                                                                               | snapshot/diff ordering and lifecycle planning stay in `@zmdb/migrations`; `ddlType` is injected so SQL does not import migrations                                                                                          |
| `aot-validator/src/index.ts`                 | rule runtime and validator helpers                                                                                      | protobuf/gRPC public calls moved to `@zmdb/protobuf` in #656; compiler-only emit/reflection code leaves through its own files                                                                                              |
| `repository/src/entity-modeling/index.ts`    | lifecycle events, subscribers, and `EventBus` → `@zmdb/orm/entity-modeling`                                             | embeddable flatten/lift and single-table-inheritance helpers → `@zmdb/schema/entity-modeling`                                                                                                                              |

No symbol may be temporarily exported from both destinations. A move and its import rewrites land together.

## 4. Public export map

All 30 current export entries across the four foundation candidates have one disposition. The independently retained MCP root is listed separately.

### Current `@zmdb/schema-core` — 9

| Old subpath      | Final public owner                                                                  |
| ---------------- | ----------------------------------------------------------------------------------- |
| `.`              | split by §3 between `@zmdb/schema`, `@zmdb/validator`, `@zmdb/orm`, and `@zmdb/app` |
| `./tags`         | `@zmdb/schema/tags`                                                                 |
| `./ir`           | `@zmdb/schema/ir`                                                                   |
| `./derive`       | `@zmdb/schema/derive`                                                               |
| `./dto`          | `@zmdb/schema/dto` plus `@zmdb/orm/dto`, by §3                                      |
| `./naming`       | `@zmdb/schema/naming`                                                               |
| `./relations`    | `@zmdb/schema/relations` plus `@zmdb/orm/relations`, by §3                          |
| `./openapi`      | `@zmdb/schema/openapi`                                                              |
| `./custom-types` | `@zmdb/schema/custom-types`                                                         |

### Current `@zmdb/mcp` — 1

| Current subpath | Final public owner |
| --------------- | ------------------ |
| `.`             | `@zmdb/mcp`        |

### Current `@zmdb/query-compiler` — 9

| Old subpath        | Final public owner         |
| ------------------ | -------------------------- |
| `.`                | `@zmdb/sql`                |
| `./comments`       | `@zmdb/sql/comments`       |
| `./fts`            | `@zmdb/sql/fts`            |
| `./joins`          | `@zmdb/sql/joins`          |
| `./aggregations`   | `@zmdb/sql/aggregations`   |
| `./naming`         | `@zmdb/schema/naming`      |
| `./outbox`         | `@zmdb/orm/outbox`         |
| `./set-ops`        | `@zmdb/sql/set-ops`        |
| `./schema-objects` | `@zmdb/sql/schema-objects` |

### Current `@zmdb/aot-validator` — 5

| Old subpath       | Final public owner              |
| ----------------- | ------------------------------- |
| `.`               | `@zmdb/validator`               |
| `./advanced`      | `@zmdb/validator/advanced`      |
| `./errors`        | `@zmdb/validator/errors`        |
| `./serialization` | `@zmdb/validator/serialization` |
| `./utilities`     | `@zmdb/validator`               |

### Current `@zmdb/repository` — 7

| Old subpath         | Final public owner                                                                  |
| ------------------- | ----------------------------------------------------------------------------------- |
| `.`                 | `@zmdb/orm`                                                                         |
| `./seeding`         | `@zmdb/orm/seeding`                                                                 |
| `./transactions`    | `@zmdb/orm/transactions`                                                            |
| `./outbox`          | `@zmdb/orm/outbox`                                                                  |
| `./replicas`        | `@zmdb/orm/replicas`                                                                |
| `./integrations`    | `@zmdb/web/integrations`                                                            |
| `./entity-modeling` | split between `@zmdb/orm/entity-modeling` and `@zmdb/schema/entity-modeling`, by §3 |

Issues #670 and #672 removed `@zmdb/repository/drivers/pg` and `@zmdb/repository/drivers/mssql`; their database packages now own those public runtimes. After cutover, the four old package names and
the remaining old subpaths are absent from workspace manifests, lockfile resolutions, source, declarations, generated artifacts, fixtures, docs, and packed consumers, except explicit removed-entry
refusal tests. A fixture may use the exact awaited `node:assert/strict` `assert.rejects(import(literal), { code })` probe, with `ERR_MODULE_NOT_FOUND` for a deleted package or
`ERR_PACKAGE_PATH_NOT_EXPORTED` for a removed subpath of an existing package, or a fixture `import type { ... } from 'literal'` immediately preceded by an explanatory `// @ts-expect-error` line.
Strict consumer typechecking proves those declarations are rejected. Unannotated type imports, runtime imports, production-file imports and positive imports in the same fixture remain findings.
`@zmdb/mcp` remains independently published. There are no forwarding packages and no `exports` aliases.

## 5. Manifest dependency disposition

Every current manifest entry has one disposition:

| Current manifest section and entry              | Final disposition                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `schema-core dependencies @zmdb/query-compiler` | deleted; DTO/populate SQL moves to ORM and naming moves to schema  |
| `schema-core dev @zmdb/aot-validator`           | schema test fixture dependency; not a schema runtime edge          |
| `schema-core dev @zmdb/compiler`                | compiler/schema test fixture dependency; not a schema runtime edge |
| `schema-core dev oxfmt`                         | root/tooling formatter only; absent from `@zmdb/schema`            |
| `schema-core dev typescript`                    | build/test-only dependency permitted on `@zmdb/schema`             |
| `query-compiler dependencies oxfmt`             | `@zmdb/migrations` dependency only                                 |
| `query-compiler dev @zmdb/compiler`             | compiler/query test fixture dependency; not a SQL runtime edge     |
| `query-compiler dev typescript`                 | build/test-only dependency permitted on `@zmdb/sql`                |
| `aot-validator dependencies @zmdb/schema-core`  | becomes `@zmdb/validator -> @zmdb/schema`                          |
| `aot-validator dev typescript`                  | build/test-only dependency permitted on `@zmdb/validator`          |
| `repository dependencies @zmdb/aot-validator`   | becomes `@zmdb/orm -> @zmdb/validator`                             |
| `repository dependencies @zmdb/query-compiler`  | becomes `@zmdb/orm -> @zmdb/sql`                                   |
| `repository dependencies @zmdb/schema-core`     | becomes `@zmdb/orm -> @zmdb/schema`                                |
| `repository dev @zmdb/compiler`                 | compiler/ORM test fixture dependency; not an ORM runtime edge      |
| `repository dev typescript`                     | build/test-only dependency permitted on `@zmdb/orm`                |

For a foundation package, “zero external dependencies” means:

- no non-`@zmdb/*` entry in `dependencies`, `optionalDependencies`, or `peerDependencies`;
- no transitive non-`@zmdb/*` runtime dependency reachable from any export;
- dev dependencies are allowed only for build/test and must be absent from packed manifests and runtime/declaration graphs;
- the current built-in allowlist for `@zmdb/schema`, `@zmdb/sql`, `@zmdb/validator`, and `@zmdb/orm` is empty. Standard globals such as `AbortSignal`, `fetch`, `crypto`, and `TextEncoder` are not
  module dependencies. A new `node:*` import requires a policy change and packed-consumer evidence;
- `@zmdb/sqlite` alone may import `node:sqlite`. PostgreSQL and SQL Server clients are external peers of their own packages.

## 6. Exact runtime DAG and build order

```text
@zmdb/schema ───────> @zmdb/validator
      │                         │
      └──────────┐              │
                 v              v
              @zmdb/orm <── @zmdb/sql
```

Arrows point from a dependency to its consumer.

The exact allowed foundation edges are:

```text
@zmdb/schema    -> []
@zmdb/sql       -> []
@zmdb/validator -> [@zmdb/schema]
@zmdb/orm       -> [@zmdb/schema, @zmdb/sql, @zmdb/validator]
```

No other direct or transitive edge is allowed. In particular, no foundation export may reach compiler, migrations, CLI, AI, MCP, jobs, web, a concrete database package, a formatter, TypeScript, a
provider SDK, or a database client.

Build order is:

1. `@zmdb/schema` and `@zmdb/sql` in parallel;
2. `@zmdb/validator`;
3. `@zmdb/orm`;
4. optional packages in parallel once their inward dependencies are built;
5. tooling packages after their runtime contracts, with `@zmdb/cli` last;
6. `zmdb` after every package it exposes.

Workspace task scheduling must derive this order from manifests. No second handwritten package list is permitted.

## 7. Generated module specifiers

Generated code is part of the runtime graph. These are the required replacements:

| Current generated/default specifier           | Final specifier          |
| --------------------------------------------- | ------------------------ |
| `@zmdb/schema-core`                           | `@zmdb/schema`           |
| `@zmdb/schema-core/tags`                      | `@zmdb/schema/tags`      |
| `@zmdb/schema-core/openapi`                   | `@zmdb/schema/openapi`   |
| `@zmdb/aot-validator/utilities`               | `@zmdb/validator`        |
| `@zmdb/aot-validator/errors`                  | `@zmdb/validator/errors` |
| `@zmdb/aot-validator/protobuf/wire`           | `@zmdb/protobuf/wire`    |
| `@zmdb/aot-validator` for protobuf/gRPC calls | `@zmdb/protobuf`         |
| `@zmdb/query-compiler/migrations*`            | `@zmdb/migrations*`      |

At the #636 baseline there were 41 measured fixed old-package specifier occurrences to rewrite. Issue #656 completed the protobuf/gRPC rows, and #710 completed the two LLM rows. The runtime-foundation
records in `scripts/architecture/exceptions.mjs` now own the exact remaining old-package import inventory with measured ceilings and removal issues; the verifier also checks every dynamically copied
source specifier in produced output. A generated comment naming an old package does not satisfy the import check.

Issue #621 adds `packages/zmdb/src/config/contract.ts` as the dependency-light authoring owner for `zmdb/config`. Its imports from the old foundation packages are type-only, so they add no emitted
runtime reachability, but they remain deliberately measured here because source and declaration ownership includes production type-only imports.

Generation preserves a source import of `zmdb`: a consumer that installed only the facade must not receive a generated deep import it did not install. Defaults are used only when the source module
cannot be determined.

## 8. Facade mapping

The facade contains no implementation. Its foundation re-exports eagerly reach only the four foundation packages; application, web, jobs, AI, tooling, and driver concerns remain behind explicit
concern subpaths unless the one-product facade contract explicitly promotes them:

| Facade surface                                      | Owner                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `zmdb` schema declarations/derivations              | `@zmdb/schema`                                                              |
| `zmdb` validation functions/errors                  | `@zmdb/validator`                                                           |
| `zmdb` generic SQL builders                         | `@zmdb/sql`                                                                 |
| `zmdb` repository/transaction functions             | `@zmdb/orm`                                                                 |
| `zmdb/app` state-transition/state-machine functions | `@zmdb/app`                                                                 |
| `zmdb/tags`, `zmdb/ir`, `zmdb/derive`               | matching `@zmdb/schema/*`                                                   |
| `zmdb/dto`                                          | explicit re-exports from `@zmdb/schema/dto` and `@zmdb/orm/dto`             |
| `zmdb/relations`                                    | explicit re-exports from `@zmdb/schema/relations` and `@zmdb/orm/relations` |
| `zmdb/migrations`                                   | `@zmdb/migrations`                                                          |
| `zmdb/compiler`                                     | `@zmdb/compiler`                                                            |
| `zmdb/postgres`, `zmdb/sqlite`, `zmdb/mssql`        | matching database package                                                   |
| `zmdb/ai`                                           | `@zmdb/ai`                                                                  |

Importing `zmdb` must not eagerly load tooling, migrations, AI, MCP, protobuf, jobs, or database clients. Its current product-root `createApp` and `Controller` vocabulary comes directly from web,
`Module` comes from app, and `defineConfig` remains dependency-light. Optional technology is selected by an explicit subpath or package.

## 9. Verifier and fixture requirements

The future verifier fails unless all of the following hold:

1. the source inventory and current/final ownership catalog are bijective;
2. workspace dependency edges equal the allowed DAG, not merely a subset;
3. each foundation packed manifest has no external production/optional/peer entry;
4. source, emitted JavaScript, declarations, export barrels, dynamic imports, generated output, and tarballs have no forbidden reachability;
5. the built-in allowlist is enforced per package;
6. no old package name or old subpath resolves;
7. no runtime root reaches compiler, migrations, formatter, TypeScript, CLI, provider, MCP, concrete driver, or test support;
8. `verify:one-walker` still identifies one schema/IR producer, one validator runtime walk, and no integration-owned duplicate;
9. every public export target exists in source and packed output;
10. generated files contain only the target specifiers in §7.

Four packed fixtures install without workspace aliases or root `paths`:

- `consumer-schema`: installs only `@zmdb/schema`;
- `consumer-sql`: installs only `@zmdb/sql`;
- `consumer-validator`: installs `@zmdb/schema` and `@zmdb/validator`;
- `consumer-orm`: installs the four foundation packages and uses a synthetic structural driver.

Database acceptance belongs to the database packages. A fifth combined application may use `@zmdb/sqlite`, but that does not weaken the dependency claim made by the four foundation fixtures.
