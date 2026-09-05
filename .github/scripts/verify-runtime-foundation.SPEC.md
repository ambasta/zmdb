# Runtime foundation boundary policy — issue #635, amended by #656, #668, #669, #705, #706, #707, #708, #709, #710, #621, #670, #672, #628 and #629

This is the normative contract for the future `.github/scripts/verify-runtime-foundation.mjs`. Issue #635 changes specifications only: it does not add the verifier, move source, rename a package, or
change a manifest.

## 1. Measured input inventory

The inventory command is:

```sh
find packages/schema-core/src packages/query-compiler/src \
  packages/aot-validator/src packages/repository/src \
  -type f -name '*.ts' ! -name '*.spec.ts' ! -name '*.type-test.ts' \
  ! -path '*/__generated__/*' ! -path '*/__budget__/*'
```

Those are exactly the TypeScript files included by the four current `tsconfig.build.json` files. Fixtures and `__testing__` helpers are included because the build configuration does not currently
exclude them; the ownership map therefore cannot pretend they are not shipped. Gitignored `__generated__` and `__budget__` directories are test-owned scratch space, not checked-in build inputs.

Re-measured for issue #636 at `f7a938615baa2e4a3b06b4cda40de32b3f5079fc`. The three database-boundary support files added by #667 are included by `query-compiler/tsconfig.build.json`. Issue #656 then
moved the protobuf/gRPC public calls and wire runtime out of the foundation candidates into zero-dependency `@zmdb/protobuf`; #705 added the provider-neutral AI edge used by the compiler; #706 and
#707 moved the Anthropic and LangChain peers; #708 moved the Vercel adapter, export and peer out of schema-core; #709 moved the MCP client/server implementation and export; #710 moved the final
provider-neutral and LangChain implementations out of schema-core and removed its four LLM exports; #669 moved the SQLite introspector and driver into its database package; #670 moved the PostgreSQL
driver and fixture out of repository; #672 moved SQL Server implementation out of the generic compiler and repository; #628 moved the TypeScript front end into `@zmdb/compiler`; and #629 moved the
generic lifecycle/introspection implementations into `@zmdb/migrations` while retaining only their structural protocols in query-compiler:

| Current package        | Build-included TypeScript files | Export-map entries |
| ---------------------- | ------------------------------: | -----------------: |
| `@zmdb/schema-core`    |                              16 |                  9 |
| `@zmdb/query-compiler` |                              25 |                  9 |
| `@zmdb/aot-validator`  |                               6 |                  5 |
| `@zmdb/repository`     |                              18 |                  8 |
| **Total**              |                          **65** |             **31** |

The four manifests contain 17 dependency entries: 5 `dependencies` and 12 `devDependencies`. They contain no `peerDependencies` or `optionalDependencies`.

Issues #670 and #672 add `@zmdb/postgres` and `@zmdb/mssql` before the hard foundation cutover. Their current inward package edges are explicit transitional boundaries; the ratchet does not recurse
through those old package roots while checking the optional verticals. Every other non-foundation edge remains forbidden. Old-package imports in the database packages and packed fixtures stay explicit
owned exception records until the coordinated foundation and final database purge remove the compatibility packages.

## 2. Exact file ownership

Every one of the 65 legacy foundation files appears exactly once below. The #636 verifier expands the current build inventory, compares it with this table, and fails for an omitted path, a duplicate
path, or a path whose declared destination no longer exists in the architecture policy. The `@zmdb/sqlite`, `@zmdb/postgres`, and `@zmdb/mssql` sections also record their package-owned production
files outside that legacy input inventory.

### `@zmdb/ai` — 0

Issue #710 moved the ten remaining provider-neutral production files directly to `packages/ai/src/`, so no old foundation file remains in this destination.

### `@zmdb/ai-anthropic` — 0

Issue #706 moved the Anthropic driver directly to `packages/ai-anthropic/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/ai-langchain` — 0

Issue #710 moved the LangChain implementation directly to `packages/ai-langchain/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/ai-vercel` — 0

Issue #708 moved the sole Vercel adapter directly to `packages/ai-vercel/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/cli` — 0

#628 deleted the old `zmdb-codegen` executable. #630 owns the later `zmdb codegen` command in the sole unified CLI.

### `@zmdb/compiler` — 0

#628 moved the TypeScript front end, compiler fixtures, and compiler test support into `packages/compiler`; those files are no longer members of this four-package runtime-foundation inventory.

### `@zmdb/jobs` — 1

```text
packages/repository/src/jobs/index.ts
```

### `@zmdb/mcp` — 0

Issue #709 moved the three MCP production files directly to `packages/mcp/src/`, so no old foundation file remains in this destination.

### `@zmdb/migrations` — 0 current legacy files

Issue #629 moved the eleven generic migration/introspection implementations into `packages/migrations/src/`. They no longer belong to the four-package legacy inventory; query-compiler retains only the
structural `introspect/types.ts` and `migrations/types.ts` protocols listed under `@zmdb/sql`.

### `@zmdb/mssql` — 0

Issue #672 moved the SQL Server driver directly to `packages/mssql/src/driver.ts`, so no old foundation file remains in this destination.

### `@zmdb/orm` — 19

```text
packages/query-compiler/src/outbox/index.ts
packages/repository/src/cache/index.ts
packages/repository/src/drivers/transactional.ts
packages/repository/src/dx/fixtures.ts
packages/repository/src/entity-modeling/index.ts
packages/repository/src/filters/index.ts
packages/repository/src/index.ts
packages/repository/src/loaders/index.ts
packages/repository/src/orders-fixture.ts
packages/repository/src/outbox/index.ts
packages/repository/src/replicas/index.ts
packages/repository/src/seeding/index.ts
packages/repository/src/streaming/index.ts
packages/repository/src/testing/official-dialects.fixture.ts
packages/repository/src/transactions/index.ts
packages/repository/src/transactions/recording-conn.ts
packages/repository/src/typed-methods/typed-methods.fixture.ts
packages/repository/src/typed-populate/fixtures.ts
```

The five fixture/support files remain owned by ORM tests and must stop being published.

### `@zmdb/postgres` — 0 current generic files

Issue #670 moved the former repository driver to `packages/postgres/src/driver.ts` and its fixture to `packages/postgres/src/testing/fixture.ts`. The fixture remains package acceptance-test support
and is excluded from the tarball.

### `@zmdb/schema` — 17

```text
packages/query-compiler/src/naming/index.ts
packages/schema-core/src/custom-types/index.ts
packages/schema-core/src/derive/__testing__/instantiations.ts
packages/schema-core/src/derive/index.ts
packages/schema-core/src/derive/query.ts
packages/schema-core/src/dto/fixtures.ts
packages/schema-core/src/dto/index.ts
packages/schema-core/src/index.ts
packages/schema-core/src/ir/index.ts
packages/schema-core/src/ir/validation-shape.ts
packages/schema-core/src/ir/vocabulary.ts
packages/schema-core/src/naming/index.ts
packages/schema-core/src/openapi/index.ts
packages/schema-core/src/relations/fixtures.ts
packages/schema-core/src/relations/index.ts
packages/schema-core/src/tags/__fixtures__/duplicate-copy.ts
packages/schema-core/src/tags/index.ts
```

The three fixture/`__testing__` files remain schema-test-owned and must stop being published. `dto/index.ts`, `relations/index.ts`, and the current root are mixed files; §3 assigns every exported
member before those files are split.

### `@zmdb/sql` — 24

```text
packages/query-compiler/src/aggregations/index.ts
packages/query-compiler/src/clauses.ts
packages/query-compiler/src/comments/index.ts
packages/query-compiler/src/compiled-query.ts
packages/query-compiler/src/dialects/index.ts
packages/query-compiler/src/dialects/protocol.ts
packages/query-compiler/src/errors.ts
packages/query-compiler/src/expressions/index.ts
packages/query-compiler/src/extensions/index.ts
packages/query-compiler/src/fts/index.ts
packages/query-compiler/src/index.ts
packages/query-compiler/src/internals.ts
packages/query-compiler/src/introspect/types.ts
packages/query-compiler/src/joins/index.ts
packages/query-compiler/src/migrations/types.ts
packages/query-compiler/src/quoting.ts
packages/query-compiler/src/schema-objects/extensions.ts
packages/query-compiler/src/schema-objects/index.ts
packages/query-compiler/src/schema-objects/types.ts
packages/query-compiler/src/set-ops/index.ts
packages/query-compiler/src/testing/capability-matrix.ts
packages/query-compiler/src/testing/database-vertical.ts
packages/query-compiler/src/testing/external-dialect.fixture.ts
packages/query-compiler/src/testing/official-dialects.fixture.ts
```

The generic package owns the injected dialect protocol and algorithms. Official vendor values may move to database verticals only by extracting them from these files; the generic definitions may not
be duplicated. The three `testing/` files freeze that protocol for #667; they remain SQL-test-owned and must be excluded from the published build after the move.

### `@zmdb/sqlite` — 7

```text
packages/sqlite/src/dialect.ts
packages/sqlite/src/driver.ts
packages/sqlite/src/embedded.ts
packages/sqlite/src/index.ts
packages/sqlite/src/introspector.ts
packages/sqlite/src/migrations.ts
packages/sqlite/src/node.ts
```

### `@zmdb/validator` — 6

```text
packages/aot-validator/src/advanced/index.ts
packages/aot-validator/src/errors.ts
packages/aot-validator/src/index.ts
packages/aot-validator/src/regex-complexity.ts
packages/aot-validator/src/serialization/index.ts
packages/aot-validator/src/utilities/index.ts
```

The validator owns rule validation, emitted-code helpers, serialization, random generation, and public validation errors. `@zmdb/protobuf` owns protobuf/gRPC public calls, artifact types, and wire
helpers; compiler-side descriptor/encoder/decoder production remains in `@zmdb/compiler`.

### `@zmdb/web` — 1

```text
packages/repository/src/integrations/index.ts
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

All 36 current export entries across the four foundation candidates have one disposition. The independently retained MCP root is listed separately.

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

### Current `@zmdb/query-compiler` — 14

| Old subpath             | Final public owner                    |
| ----------------------- | ------------------------------------- |
| `.`                     | `@zmdb/sql`                           |
| `./comments`            | `@zmdb/sql/comments`                  |
| `./fts`                 | `@zmdb/sql/fts`                       |
| `./joins`               | `@zmdb/sql/joins`                     |
| `./aggregations`        | `@zmdb/sql/aggregations`              |
| `./introspect`          | `@zmdb/migrations/introspect`         |
| `./introspect/runtime`  | `@zmdb/migrations/introspect/runtime` |
| `./migrations`          | `@zmdb/migrations`                    |
| `./migrations/embedded` | `@zmdb/migrations/embedded`           |
| `./migrations/runner`   | `@zmdb/migrations/runner`             |
| `./naming`              | `@zmdb/schema/naming`                 |
| `./outbox`              | `@zmdb/orm/outbox`                    |
| `./set-ops`             | `@zmdb/sql/set-ops`                   |
| `./schema-objects`      | `@zmdb/sql/schema-objects`            |

### Current `@zmdb/aot-validator` — 5

| Old subpath       | Final public owner              |
| ----------------- | ------------------------------- |
| `.`               | `@zmdb/validator`               |
| `./advanced`      | `@zmdb/validator/advanced`      |
| `./errors`        | `@zmdb/validator/errors`        |
| `./serialization` | `@zmdb/validator/serialization` |
| `./utilities`     | `@zmdb/validator`               |

### Current `@zmdb/repository` — 8

| Old subpath         | Final public owner                                                                  |
| ------------------- | ----------------------------------------------------------------------------------- |
| `.`                 | `@zmdb/orm`                                                                         |
| `./seeding`         | `@zmdb/orm/seeding`                                                                 |
| `./transactions`    | `@zmdb/orm/transactions`                                                            |
| `./outbox`          | `@zmdb/orm/outbox`                                                                  |
| `./replicas`        | `@zmdb/orm/replicas`                                                                |
| `./integrations`    | `@zmdb/web/integrations`                                                            |
| `./entity-modeling` | split between `@zmdb/orm/entity-modeling` and `@zmdb/schema/entity-modeling`, by §3 |
| `./jobs`            | `@zmdb/jobs`                                                                        |

Issues #670 and #672 removed `@zmdb/repository/drivers/pg` and `@zmdb/repository/drivers/mssql`; their database packages now own those public runtimes. After cutover, the four old package names and
the remaining 36 old subpaths are absent from workspace manifests, lockfile resolutions, source, declarations, generated artifacts, fixtures, docs, and packed consumers. `@zmdb/mcp` remains
independently published. There are no forwarding packages and no `exports` aliases.

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
| `zmdb/compiler`, `zmdb/unplugin`                    | `@zmdb/compiler`                                                            |
| `zmdb/postgres`, `zmdb/sqlite`, `zmdb/mssql`        | matching database package                                                   |
| `zmdb/ai`                                           | `@zmdb/ai`                                                                  |

Importing `zmdb` must not eagerly load tooling, migrations, AI, MCP, protobuf, web/jobs, or database clients. Optional technology is selected by an explicit subpath or package.

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
