# Runtime foundation boundary policy — issue #635, amended by #656, #668, #669, #705, #706, #707, #708, #709 and #710

This is the normative contract for the future `.github/scripts/verify-runtime-foundation.mjs`. Issue #635 changes specifications only: it does not add the verifier, move source, rename a package, or
change a manifest.

## 1. Measured input inventory

The inventory command is:

```sh
find packages/schema-core/src packages/query-compiler/src \
  packages/aot-validator/src packages/repository/src \
  -type f -name '*.ts' ! -name '*.spec.ts' ! -name '*.type-test.ts' \
  ! -path '*/__generated__/*'
```

Those are exactly the TypeScript files included by the four current `tsconfig.build.json` files. Fixtures and `__testing__` helpers are included because the build configuration does not currently
exclude them; the ownership map therefore cannot pretend they are not shipped. Gitignored `__generated__` directories are test-owned scratch space, not checked-in build inputs.

Re-measured for issue #636 at `f7a938615baa2e4a3b06b4cda40de32b3f5079fc`. The three database-boundary support files added by #667 are included by `query-compiler/tsconfig.build.json`. Issue #656 then
moved the protobuf/gRPC public calls and wire runtime out of the foundation candidates into zero-dependency `@zmdb/protobuf`; #705 added the provider-neutral AI edge used by the compiler; #706 and
#707 moved the Anthropic and LangChain peers; #708 moved the Vercel adapter, export and peer out of schema-core; #709 moved the MCP client/server implementation and export; #710 moved the final
provider-neutral and LangChain implementations out of schema-core and removed its four LLM exports; and #669 moved the SQLite introspector and driver into the database package:

| Current package        | Build-included TypeScript files | Export-map entries |
| ---------------------- | ------------------------------: | -----------------: |
| `@zmdb/schema-core`    |                              14 |                  9 |
| `@zmdb/query-compiler` |                              35 |                 14 |
| `@zmdb/aot-validator`  |                              55 |                 14 |
| `@zmdb/repository`     |                              21 |                 10 |
| **Total**              |                         **125** |             **47** |

The four manifests contain 22 dependency entries: 7 `dependencies`, 2 `peerDependencies`, and 13 `devDependencies`. They contain no `optionalDependencies`.

## 2. Exact file ownership

Every one of the 125 legacy foundation files appears exactly once below. The #636 verifier expands the current build inventory, compares it with this table, and fails for an omitted path, a duplicate
path, or a path whose declared destination no longer exists in the architecture policy. The `@zmdb/sqlite` section also records its seven package-owned production files outside that legacy input
inventory.

### `@zmdb/ai` — 0

Issue #710 moved the ten remaining provider-neutral production files directly to `packages/ai/src/`, so no old foundation file remains in this destination.

### `@zmdb/ai-anthropic` — 0

Issue #706 moved the Anthropic driver directly to `packages/ai-anthropic/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/ai-langchain` — 0

Issue #710 moved the LangChain implementation directly to `packages/ai-langchain/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/ai-vercel` — 0

Issue #708 moved the sole Vercel adapter directly to `packages/ai-vercel/src/index.ts`, so no old foundation file remains in this destination.

### `@zmdb/cli` — 1

```text
packages/aot-validator/src/cli/bin.ts
```

The old `zmdb-codegen` executable is deleted. Its argument parsing becomes the `zmdb codegen` command; the callable code-generation library belongs to `@zmdb/compiler`.

### `@zmdb/compiler` — 47

```text
packages/aot-validator/src/cli/index.ts
packages/aot-validator/src/cli/scan.ts
packages/aot-validator/src/cli/witness.ts
packages/aot-validator/src/emit/__testing__/project.ts
packages/aot-validator/src/emit/index.ts
packages/aot-validator/src/emit/shape.ts
packages/aot-validator/src/lint/__fixtures__/nullable-tags.fixed.ts
packages/aot-validator/src/lint/__fixtures__/nullable-tags.input.ts
packages/aot-validator/src/lint/__fixtures__/rule-tester.ts
packages/aot-validator/src/lint/__fixtures__/unknown-json.input.ts
packages/aot-validator/src/lint/__fixtures__/unknown-json.suggested.ts
packages/aot-validator/src/lint/__fixtures__/valid-near-misses.ts
packages/aot-validator/src/lint/ast.ts
packages/aot-validator/src/lint/host-types.ts
packages/aot-validator/src/lint/index.ts
packages/aot-validator/src/lint/rules/no-distributed-nullable-tags.ts
packages/aot-validator/src/lint/rules/no-empty-patch.ts
packages/aot-validator/src/lint/rules/no-interpolated-sql.ts
packages/aot-validator/src/lint/rules/no-unbounded-find.ts
packages/aot-validator/src/lint/rules/no-unknown-json-column.ts
packages/aot-validator/src/lint/rules/require-sql-on-number.ts
packages/aot-validator/src/lint/types.ts
packages/aot-validator/src/plugin/index.ts
packages/aot-validator/src/plugin/inline-bench.ts
packages/aot-validator/src/plugin/metro.ts
packages/aot-validator/src/protobuf/__testing__/fixture.ts
packages/aot-validator/src/protobuf/decode.ts
packages/aot-validator/src/protobuf/descriptor.ts
packages/aot-validator/src/protobuf/encode.ts
packages/aot-validator/src/protobuf/grpc-ir.ts
packages/aot-validator/src/reflect/__fixtures__/codemod-corpus.ts
packages/aot-validator/src/reflect/__fixtures__/codemod-refusals.ts
packages/aot-validator/src/reflect/__fixtures__/codemod-tables.ts
packages/aot-validator/src/reflect/__fixtures__/constructs.ts
packages/aot-validator/src/reflect/__fixtures__/documents.ts
packages/aot-validator/src/reflect/__fixtures__/legacy-dsl.ts
packages/aot-validator/src/reflect/__fixtures__/naming-strategy.ts
packages/aot-validator/src/reflect/__fixtures__/payloads.ts
packages/aot-validator/src/reflect/__fixtures__/schema-values-refusals.ts
packages/aot-validator/src/reflect/__fixtures__/schema-values.ts
packages/aot-validator/src/reflect/__fixtures__/tables.ts
packages/aot-validator/src/reflect/callsites.ts
packages/aot-validator/src/reflect/index.ts
packages/aot-validator/src/reflect/session.ts
packages/aot-validator/src/testing/index.ts
packages/aot-validator/src/transformer.ts
packages/aot-validator/src/unplugin.ts
```

The fixture and `__testing__` paths remain owned by compiler tests but must be excluded from the published build after the move.

### `@zmdb/jobs` — 1

```text
packages/repository/src/jobs/index.ts
```

### `@zmdb/mcp` — 0

Issue #709 moved the three MCP production files directly to `packages/mcp/src/`, so no old foundation file remains in this destination.

### `@zmdb/migrations` — 10

```text
packages/query-compiler/src/introspect/common.ts
packages/query-compiler/src/introspect/drift.ts
packages/query-compiler/src/introspect/emit.ts
packages/query-compiler/src/introspect/index.ts
packages/query-compiler/src/introspect/mysql.ts
packages/query-compiler/src/introspect/postgres.ts
packages/query-compiler/src/introspect/tagged-property.ts
packages/query-compiler/src/migrations/embedded.ts
packages/query-compiler/src/migrations/index.ts
packages/query-compiler/src/migrations/runner.ts
```

The SQLite introspector has moved to `@zmdb/sqlite`. The ten files above remain the current generic migration/introspection ownership set until the tooling-package cutover.

### `@zmdb/mssql` — 1

```text
packages/repository/src/drivers/mssql.ts
```

### `@zmdb/orm` — 17

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
packages/repository/src/transactions/index.ts
packages/repository/src/transactions/recording-conn.ts
packages/repository/src/typed-methods/fixtures.ts
packages/repository/src/typed-populate/fixtures.ts
```

The five fixture/support files remain owned by ORM tests and must stop being published.

### `@zmdb/postgres` — 2

```text
packages/repository/src/drivers/pg.ts
packages/repository/src/pg-fixture.ts
```

`pg-fixture.ts` becomes package acceptance-test support and is excluded from the tarball.

### `@zmdb/schema` — 15

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
packages/schema-core/src/naming/index.ts
packages/schema-core/src/openapi/index.ts
packages/schema-core/src/relations/fixtures.ts
packages/schema-core/src/relations/index.ts
packages/schema-core/src/tags/__fixtures__/duplicate-copy.ts
packages/schema-core/src/tags/index.ts
```

The three fixture/`__testing__` files remain schema-test-owned and must stop being published. `dto/index.ts`, `relations/index.ts`, and the current root are mixed files; §3 assigns every exported
member before those files are split.

### `@zmdb/sql` — 23

```text
packages/query-compiler/src/aggregations/index.ts
packages/query-compiler/src/clauses.ts
packages/query-compiler/src/comments/index.ts
packages/query-compiler/src/compiled-query.ts
packages/query-compiler/src/dialects/index.ts
packages/query-compiler/src/dialects/mssql.ts
packages/query-compiler/src/dialects/protocol.ts
packages/query-compiler/src/errors.ts
packages/query-compiler/src/expressions/index.ts
packages/query-compiler/src/extensions/index.ts
packages/query-compiler/src/fts/index.ts
packages/query-compiler/src/index.ts
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

### `@zmdb/validator` — 7

```text
packages/aot-validator/src/advanced/ast.ts
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

All 47 current export entries across the four foundation candidates have one disposition. The independently retained MCP root is listed separately.

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

### Current `@zmdb/aot-validator` — 14

| Old subpath       | Final public owner              |
| ----------------- | ------------------------------- |
| `.`               | `@zmdb/validator`               |
| `./advanced`      | `@zmdb/validator/advanced`      |
| `./emit`          | `@zmdb/compiler/emit`           |
| `./errors`        | `@zmdb/validator/errors`        |
| `./lint`          | `@zmdb/compiler/lint`           |
| `./serialization` | `@zmdb/validator/serialization` |
| `./utilities`     | `@zmdb/validator`               |
| `./metro`         | `@zmdb/compiler/metro`          |
| `./plugin`        | `@zmdb/compiler/plugin`         |
| `./reflect`       | `@zmdb/compiler/reflect`        |
| `./testing`       | `@zmdb/compiler/testing`        |
| `./codegen`       | `@zmdb/compiler/codegen`        |
| `./transformer`   | `@zmdb/compiler/transformer`    |
| `./unplugin`      | `@zmdb/compiler/unplugin`       |

### Current `@zmdb/repository` — 10

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
| `./drivers/pg`      | `@zmdb/postgres`                                                                    |
| `./drivers/mssql`   | `@zmdb/mssql`                                                                       |

After cutover, the four old package names and all 47 old subpaths are absent from workspace manifests, lockfile resolutions, source, declarations, generated artifacts, fixtures, docs, and packed
consumers. `@zmdb/mcp` remains independently published. There are no forwarding packages and no `exports` aliases.

## 5. Manifest dependency disposition

Every current manifest entry has one disposition:

| Current manifest section and entry              | Final disposition                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `schema-core dependencies @zmdb/query-compiler` | deleted; DTO/populate SQL moves to ORM and naming moves to schema  |
| `schema-core peers @anthropic-ai/sdk`           | `@zmdb/ai-anthropic` peer only                                     |
| `schema-core peers @langchain/core`             | `@zmdb/ai-langchain` peer only                                     |
| `schema-core dev @anthropic-ai/sdk`             | `@zmdb/ai-anthropic` dev dependency                                |
| `schema-core dev @zmdb/aot-validator`           | compiler/schema test fixture dependency; not a schema runtime edge |
| `schema-core dev oxfmt`                         | root/tooling formatter only; absent from `@zmdb/schema`            |
| `schema-core dev typescript`                    | build/test-only dependency permitted on `@zmdb/schema`             |
| `query-compiler dependencies oxfmt`             | `@zmdb/migrations` dependency only                                 |
| `query-compiler dev typescript`                 | build/test-only dependency permitted on `@zmdb/sql`                |
| `aot-validator dependencies @zmdb/ai`           | `@zmdb/compiler` build-time dependency; never a foundation edge    |
| `aot-validator dependencies @zmdb/schema-core`  | becomes `@zmdb/validator -> @zmdb/schema`                          |
| `aot-validator peers oxlint`                    | `@zmdb/compiler` peer only                                         |
| `aot-validator peers typescript`                | `@zmdb/compiler` peer only                                         |
| `aot-validator dev oxlint`                      | `@zmdb/compiler` dev dependency                                    |
| `aot-validator dev @zmdb/protobuf`              | compiler boundary-test dev dependency; never a runtime edge        |
| `aot-validator dev protobufjs`                  | compiler protobuf-conformance dev dependency; never a runtime edge |
| `aot-validator dev typescript`                  | `@zmdb/compiler` dev dependency                                    |
| `repository dependencies @zmdb/aot-validator`   | becomes `@zmdb/orm -> @zmdb/validator`                             |
| `repository dependencies @zmdb/query-compiler`  | becomes `@zmdb/orm -> @zmdb/sql`                                   |
| `repository dependencies @zmdb/schema-core`     | becomes `@zmdb/orm -> @zmdb/schema`                                |
| `repository dev @types/mssql`                   | `@zmdb/mssql` dev dependency                                       |
| `repository dev @types/pg`                      | `@zmdb/postgres` dev dependency                                    |
| `repository dev mssql`                          | `@zmdb/mssql` dev dependency and peer                              |
| `repository dev pg`                             | `@zmdb/postgres` dev dependency and peer                           |
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
baseline now owns the exact remaining old-package import inventory; the verifier also checks every dynamically copied source specifier in produced output. A generated comment naming an old package
does not satisfy the import check.

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
