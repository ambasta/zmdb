# Tooling ownership policy — verifier contract

> Status: **FROZEN** for GitHub sub-issue #626, amended by #627 after #667 added database-boundary test support, remeasured for #681, and amended by #656 after the protobuf runtime/public-owner
> extraction.

## 1. Extraction rule and totals

The shipped/build-input source inventory is every file below `packages/{aot-validator,query-compiler,zmdb}/src` whose extension is `.ts`, `.js`, `.json` or `.proto`, excluding `SPEC.md`, `*.spec.ts`
and `*.type-test.ts`. Checked-in declarations, generated JavaScript, witnesses and fixture data count because the publish manifest ships `src` and the build consumes or copies them.

The inventory has **138 paths**, each exactly once:

```json
{
  "compiler": 30,
  "migrations": 20,
  "cli": 20,
  "runtime": 23,
  "facade": 12,
  "optional-integration": 4,
  "test-only": 28,
  "obsolete": 1
}
```

An ownership verifier must fail on an omitted current path, a path in two groups, a catalog path that no longer exists, or a changed total without an intentional edit to this policy.

## 2. Exact source move map

The line grammar is `<target-owner><TAB><current-path>`.

```text
compiler	packages/aot-validator/src/cli/index.ts
compiler	packages/aot-validator/src/cli/scan.ts
compiler	packages/aot-validator/src/cli/witness.ts
compiler	packages/aot-validator/src/emit/__testing__/project.ts
compiler	packages/aot-validator/src/emit/index.ts
compiler	packages/aot-validator/src/emit/shape.ts
compiler	packages/aot-validator/src/lint/ast.ts
compiler	packages/aot-validator/src/lint/host-types.ts
compiler	packages/aot-validator/src/lint/index.ts
compiler	packages/aot-validator/src/lint/rules/no-distributed-nullable-tags.ts
compiler	packages/aot-validator/src/lint/rules/no-empty-patch.ts
compiler	packages/aot-validator/src/lint/rules/no-interpolated-sql.ts
compiler	packages/aot-validator/src/lint/rules/no-unbounded-find.ts
compiler	packages/aot-validator/src/lint/rules/no-unknown-json-column.ts
compiler	packages/aot-validator/src/lint/rules/require-sql-on-number.ts
compiler	packages/aot-validator/src/lint/types.ts
compiler	packages/aot-validator/src/plugin/index.ts
compiler	packages/aot-validator/src/plugin/inline-bench.ts
compiler	packages/aot-validator/src/plugin/metro.ts
compiler	packages/aot-validator/src/reflect/callsites.ts
compiler	packages/aot-validator/src/reflect/index.ts
compiler	packages/aot-validator/src/reflect/session.ts
compiler	packages/aot-validator/src/testing/index.ts
compiler	packages/aot-validator/src/transformer.ts
compiler	packages/aot-validator/src/unplugin.ts
compiler	packages/zmdb/src/config/index.ts
compiler	packages/zmdb/src/config/index.zmdb.generated.d.ts
compiler	packages/zmdb/src/config/index.zmdb.generated.js
compiler	packages/zmdb/src/config/index.zmdb.witness.ts
compiler	packages/zmdb/src/unplugin.ts
migrations	packages/query-compiler/src/introspect/common.ts
migrations	packages/query-compiler/src/introspect/drift.ts
migrations	packages/query-compiler/src/introspect/emit.ts
migrations	packages/query-compiler/src/introspect/index.ts
migrations	packages/query-compiler/src/introspect/mysql.ts
migrations	packages/query-compiler/src/introspect/postgres.ts
migrations	packages/query-compiler/src/introspect/sqlite.ts
migrations	packages/query-compiler/src/introspect/tagged-property.ts
migrations	packages/query-compiler/src/migrations/embedded.ts
migrations	packages/query-compiler/src/migrations/index.ts
migrations	packages/query-compiler/src/migrations/runner.ts
migrations	packages/zmdb/src/cli/commands/check.ts
migrations	packages/zmdb/src/cli/commands/embed.ts
migrations	packages/zmdb/src/cli/commands/export.ts
migrations	packages/zmdb/src/cli/commands/generate.ts
migrations	packages/zmdb/src/cli/commands/migrate.ts
migrations	packages/zmdb/src/cli/commands/pull.ts
migrations	packages/zmdb/src/cli/commands/push.ts
migrations	packages/zmdb/src/cli/commands/upgrade.ts
migrations	packages/zmdb/src/cli/migration-files.ts
cli	packages/zmdb/src/cli/args.ts
cli	packages/zmdb/src/cli/atomic.ts
cli	packages/zmdb/src/cli/bin.ts
cli	packages/zmdb/src/cli/commands/new.ts
cli	packages/zmdb/src/cli/commands/studio.ts
cli	packages/zmdb/src/cli/config.ts
cli	packages/zmdb/src/cli/errors.ts
cli	packages/zmdb/src/cli/index.ts
cli	packages/zmdb/src/cli/output.ts
cli	packages/zmdb/src/cli/repl.ts
cli	packages/zmdb/src/cli/scaffold.ts
cli	packages/zmdb/src/cli/templates/command.ts
cli	packages/zmdb/src/cli/templates/controller.ts
cli	packages/zmdb/src/cli/templates/index.ts
cli	packages/zmdb/src/cli/templates/module.ts
cli	packages/zmdb/src/cli/templates/project.ts
cli	packages/zmdb/src/cli/templates/repository.ts
cli	packages/zmdb/src/cli/templates/schema.ts
cli	packages/zmdb/src/cli/templates/types.ts
cli	packages/zmdb/src/studio/index.ts
runtime	packages/aot-validator/src/advanced/index.ts
runtime	packages/aot-validator/src/errors.ts
runtime	packages/aot-validator/src/index.ts
runtime	packages/aot-validator/src/regex-complexity.ts
runtime	packages/aot-validator/src/serialization/index.ts
runtime	packages/aot-validator/src/utilities/index.ts
runtime	packages/query-compiler/src/aggregations/index.ts
runtime	packages/query-compiler/src/clauses.ts
runtime	packages/query-compiler/src/comments/index.ts
runtime	packages/query-compiler/src/dialects/index.ts
runtime	packages/query-compiler/src/dialects/mssql.ts
runtime	packages/query-compiler/src/errors.ts
runtime	packages/query-compiler/src/expressions/index.ts
runtime	packages/query-compiler/src/extensions/index.ts
runtime	packages/query-compiler/src/fts/index.ts
runtime	packages/query-compiler/src/index.ts
runtime	packages/query-compiler/src/joins/index.ts
runtime	packages/query-compiler/src/naming/index.ts
runtime	packages/query-compiler/src/outbox/index.ts
runtime	packages/query-compiler/src/quoting.ts
runtime	packages/query-compiler/src/schema-objects/extensions.ts
runtime	packages/query-compiler/src/schema-objects/index.ts
runtime	packages/query-compiler/src/set-ops/index.ts
facade	packages/zmdb/src/derive.ts
facade	packages/zmdb/src/drivers-mssql.ts
facade	packages/zmdb/src/drivers-pg.ts
facade	packages/zmdb/src/drivers-sqlite.ts
facade	packages/zmdb/src/dto.ts
facade	packages/zmdb/src/index.ts
facade	packages/zmdb/src/ir.ts
facade	packages/zmdb/src/relations.ts
facade	packages/zmdb/src/tags.ts
facade	packages/zmdb/src/web-contract-compiler.ts
facade	packages/zmdb/src/web-contract.ts
facade	packages/zmdb/src/web.ts
optional-integration	packages/aot-validator/src/protobuf/decode.ts
optional-integration	packages/aot-validator/src/protobuf/descriptor.ts
optional-integration	packages/aot-validator/src/protobuf/encode.ts
optional-integration	packages/aot-validator/src/protobuf/grpc-ir.ts
test-only	packages/aot-validator/src/lint/__fixtures__/nullable-tags.fixed.ts
test-only	packages/aot-validator/src/lint/__fixtures__/nullable-tags.input.ts
test-only	packages/aot-validator/src/lint/__fixtures__/rule-tester.ts
test-only	packages/aot-validator/src/lint/__fixtures__/unknown-json.input.ts
test-only	packages/aot-validator/src/lint/__fixtures__/unknown-json.suggested.ts
test-only	packages/aot-validator/src/lint/__fixtures__/valid-near-misses.ts
test-only	packages/aot-validator/src/protobuf/__fixtures__/reference.proto
test-only	packages/aot-validator/src/protobuf/__testing__/fixture.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/codemod-corpus.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/codemod-refusals.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/codemod-tables.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/constructs.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/documents.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/legacy-dsl.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/naming-strategy.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/payloads.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/schema-values-refusals.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/schema-values.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/tables.ts
test-only	packages/aot-validator/src/reflect/__fixtures__/tsconfig.json
test-only	packages/query-compiler/src/introspect/__fixtures__/mysql-8.4.11.json
test-only	packages/query-compiler/src/testing/capability-matrix.ts
test-only	packages/query-compiler/src/testing/database-vertical.ts
test-only	packages/query-compiler/src/testing/external-dialect.fixture.ts
test-only	packages/zmdb/src/cli/__fixtures__/project/package.json
test-only	packages/zmdb/src/cli/__fixtures__/project/src/schema.ts
test-only	packages/zmdb/src/cli/__fixtures__/project/tsconfig.json
test-only	packages/zmdb/src/cli/__fixtures__/project/zmdb.config.ts
obsolete	packages/aot-validator/src/cli/bin.ts
```

`test-only` paths follow the concern they test when implementation moves them; they never become published public APIs. The protobuf test paths remain with the optional-integration owner rather than
moving to compiler. `obsolete` means deletion with no replacement file; the behavior moves to the `codegen` command in `@zmdb/cli`.

## 3. Public export and executable map

There are **42 current export keys**: 14 AOT validator, 13 query compiler and 15 facade.

```text
@zmdb/aot-validator	.	retain	@zmdb/aot-validator
@zmdb/aot-validator	./advanced	retain	@zmdb/aot-validator/advanced
@zmdb/aot-validator	./emit	delete-after-move	@zmdb/compiler/emit
@zmdb/aot-validator	./errors	retain	@zmdb/aot-validator/errors
@zmdb/aot-validator	./lint	delete-after-move	@zmdb/compiler/lint
@zmdb/aot-validator	./serialization	retain	@zmdb/aot-validator/serialization
@zmdb/aot-validator	./utilities	retain	@zmdb/aot-validator/utilities
@zmdb/aot-validator	./metro	delete-after-move	@zmdb/compiler/metro
@zmdb/aot-validator	./plugin	delete-after-move	@zmdb/compiler/unplugin
@zmdb/aot-validator	./reflect	delete-after-move	@zmdb/compiler/reflect
@zmdb/aot-validator	./testing	delete-after-move	@zmdb/compiler/testing
@zmdb/aot-validator	./codegen	delete-after-move	@zmdb/compiler
@zmdb/aot-validator	./transformer	delete-after-move	@zmdb/compiler/transform
@zmdb/aot-validator	./unplugin	delete-after-move	@zmdb/compiler/unplugin
@zmdb/query-compiler	.	retain	@zmdb/query-compiler
@zmdb/query-compiler	./comments	retain	@zmdb/query-compiler/comments
@zmdb/query-compiler	./fts	retain	@zmdb/query-compiler/fts
@zmdb/query-compiler	./joins	retain	@zmdb/query-compiler/joins
@zmdb/query-compiler	./aggregations	retain	@zmdb/query-compiler/aggregations
@zmdb/query-compiler	./introspect	delete-after-move	@zmdb/migrations/introspect
@zmdb/query-compiler	./migrations	delete-after-move	@zmdb/migrations
@zmdb/query-compiler	./migrations/embedded	delete-after-move	@zmdb/migrations/embedded
@zmdb/query-compiler	./migrations/runner	delete-after-move	@zmdb/migrations/runner
@zmdb/query-compiler	./naming	retain	@zmdb/query-compiler/naming
@zmdb/query-compiler	./outbox	retain	@zmdb/query-compiler/outbox
@zmdb/query-compiler	./set-ops	retain	@zmdb/query-compiler/set-ops
@zmdb/query-compiler	./schema-objects	retain	@zmdb/query-compiler/schema-objects
zmdb	.	retain	zmdb
zmdb	./tags	retain	zmdb/tags
zmdb	./ir	retain	zmdb/ir
zmdb	./derive	retain	zmdb/derive
zmdb	./dto	retain	zmdb/dto
zmdb	./relations	retain	zmdb/relations
zmdb	./drivers/sqlite	retain-until-database-epic	zmdb/drivers/sqlite
zmdb	./drivers/pg	retain-until-database-epic	zmdb/drivers/pg
zmdb	./drivers/mssql	retain-until-database-epic	zmdb/drivers/mssql
zmdb	./web	retain	zmdb/web
zmdb	./web/contract	retain	@zmdb/web/contract
zmdb	./web/contract/compiler	retain	@zmdb/web/contract/compiler
zmdb	./unplugin	release-governed-alias	zmdb/compiler
zmdb	./cli	retain-product-facade	@zmdb/cli
zmdb	./config	retain-facade	@zmdb/compiler/config
```

`delete-after-move` records the target ownership disposition, not permission to remove an export in an arbitrary implementation commit. #721/#728 select the coordinated removal version and changelog
entry. Stable `zmdb/*` product facades are not compatibility forwarders: they remain while their implementation moves.

The two current binaries are:

```text
@zmdb/aot-validator	zmdb-codegen	delete
zmdb	zmdb	move-to-@zmdb/cli
```

The target repository has one bin declaration, `@zmdb/cli` → `zmdb`. After the release plan schedules the executable migration, a verifier fails if `zmdb-codegen` appears in any manifest, if `zmdb`
declares a bin, or if more than one workspace declares the `zmdb` command.

## 4. Exact tooling DAG

The line grammar is `<dependency><TAB><consumer><TAB><kind>`. These are the complete workspace edges introduced or required by this tooling target:

```text
@zmdb/query-compiler	@zmdb/compiler	required
@zmdb/schema-core	@zmdb/compiler	required
@zmdb/aot-validator	@zmdb/compiler	required
@zmdb/query-compiler	@zmdb/migrations	required
@zmdb/compiler	@zmdb/cli	required
@zmdb/migrations	@zmdb/cli	required
@zmdb/cli	zmdb	required
@zmdb/compiler	zmdb	required-product-and-config-facades
@zmdb/migrations	zmdb	required-product-facade
@zmdb/web	@zmdb/cli	optional-lazy-command
```

`@zmdb/compiler` and `@zmdb/migrations` have no edge between them. The CLI composes their public results. `@zmdb/web` is not evaluated by the CLI root; it is an optional peer loaded only for the
selected application commands. The three tooling packages reach `zmdb` only through stable concern facades, and none is reachable from the product root. No runtime package has a consumer-to-tooling
edge. A topological sort must contain query/schema/validator protocols before compiler/migrations, both tooling libraries before CLI, and all three tooling packages before the product facade.

## 5. Manifest-edge move map

There are **17 current dependency/peer/development edges** in the three manifests.

```text
packages/aot-validator/package.json	dependency	@zmdb/schema-core	retain-runtime
packages/aot-validator/package.json	peer	oxlint	move-compiler-optional-peer
packages/aot-validator/package.json	peer	typescript	move-compiler-peer
packages/aot-validator/package.json	dev	oxlint	move-compiler-dev
packages/aot-validator/package.json	dev	protobufjs	retain-optional-integration-dev
packages/aot-validator/package.json	dev	@zmdb/protobuf	retain-compiler-boundary-tests
packages/aot-validator/package.json	dev	typescript	move-compiler-dev
packages/query-compiler/package.json	dependency	oxfmt	move-migrations-dependency
packages/query-compiler/package.json	dev	typescript	retain-query-build
packages/zmdb/package.json	dependency	@zmdb/aot-validator	retain-facade
packages/zmdb/package.json	dependency	@zmdb/query-compiler	retain-facade
packages/zmdb/package.json	dependency	@zmdb/repository	retain-facade
packages/zmdb/package.json	dependency	@zmdb/schema-core	retain-facade
packages/zmdb/package.json	dependency	@zmdb/web	retain-facade
packages/zmdb/package.json	dependency	esbuild	move-cli-optional-peer-and-dev
packages/zmdb/package.json	dependency	oxfmt	move-cli-dependency
packages/zmdb/package.json	dev	typescript	retain-facade-build
```

New dependency declarations make `@zmdb/cli` depend on `@zmdb/compiler` and `@zmdb/migrations`, while `zmdb` depends on all three for `zmdb/cli`, `zmdb/compiler`, `zmdb/migrations` and `zmdb/config`.
The migrations package owns the only required `oxfmt` edge used by declaration/migration generation; CLI scaffolding may keep its own direct formatter edge. The SQL and validator runtime roots have no
formatter or compiler peer after extraction.

## 6. Fixtures and packed consumers

The 28 internal fixture/test-support paths are already enumerated as `test-only` in §2. The three external fixture trees contain **27 files**:

```text
fixtures/consumer-cli/package.json
fixtures/consumer-cli/src/model.ts
fixtures/consumer-cli/src/orders.ts
fixtures/consumer-cli/src/orders.zmdb.generated.d.ts
fixtures/consumer-cli/src/orders.zmdb.generated.js
fixtures/consumer-cli/src/orders.zmdb.witness.ts
fixtures/consumer-cli/src/probe.ts
fixtures/consumer-cli/tsconfig.json
fixtures/consumer-cli/zmdb.config.ts
fixtures/consumer-plugin/build.mjs
fixtures/consumer-plugin/package.json
fixtures/consumer-plugin/src/model.ts
fixtures/consumer-plugin/src/orders.ts
fixtures/consumer-plugin/src/probe.ts
fixtures/consumer-plugin/tsconfig.json
fixtures/consumer-plugin/zmdb.config.ts
fixtures/consumer-metro/babel.config.js
fixtures/consumer-metro/custom-transformer.js
fixtures/consumer-metro/metro.base.js
fixtures/consumer-metro/metro.config.js
fixtures/consumer-metro/metro.unconfigured.config.js
fixtures/consumer-metro/package.json
fixtures/consumer-metro/src/globals.d.ts
fixtures/consumer-metro/src/index.ts
fixtures/consumer-metro/src/model.ts
fixtures/consumer-metro/src/plain.ts
fixtures/consumer-metro/tsconfig.json
```

`consumer-cli` currently proves the old codegen executable and becomes the compiler/no-bundler fixture. `consumer-plugin` and `consumer-metro` become compiler adapter fixtures. Separate packed
fixtures must be added for standalone migrations and for the installed `@zmdb/cli` binary; neither may be simulated by workspace path mappings.

## 7. Benchmarks and generated artifacts

These **19 benchmark files** name or exercise the compiler/codegen boundary and must migrate as one measured set:

```text
benchmarks/RESULTS.md
benchmarks/harness/README.md
benchmarks/harness/framework/SPEC.md
benchmarks/harness/framework/app.ts
benchmarks/harness/framework/model.ts
benchmarks/harness/framework/model.zmdb.generated.d.ts
benchmarks/harness/framework/model.zmdb.generated.js
benchmarks/harness/framework/model.zmdb.witness.ts
benchmarks/harness/framework/run.sh
benchmarks/harness/validation/aot-source.ts
benchmarks/harness/validation/aot.generated.ts
benchmarks/harness/validation/model.ts
benchmarks/harness/validation/shallow.bench.ts
benchmarks/harness/validation/validation.bench.ts
benchmarks/participants/validation/cases/zmdb-aot/src/index.ts
benchmarks/participants/validation/cases/zmdb/src/index.ts
benchmarks/scripts/generate-validation-model.mjs
benchmarks/src/runner.ts
benchmarks/src/validation/adapter.spec.ts
```

The repository has **12 checked-in generated artifacts** with **15 static import declarations**:

```text
compiler-benchmark	benchmarks/harness/framework/model.zmdb.generated.d.ts	1
compiler-benchmark	benchmarks/harness/framework/model.zmdb.generated.js	1
compiler-benchmark	benchmarks/harness/framework/model.zmdb.witness.ts	2
compiler-benchmark	benchmarks/harness/validation/aot.generated.ts	0
compiler-benchmark	benchmarks/harness/validation/model.generated.ts	1
compiler-benchmark	benchmarks/harness/validation/shallow.generated.ts	0
compiler-fixture	fixtures/consumer-cli/src/orders.zmdb.generated.d.ts	2
compiler-fixture	fixtures/consumer-cli/src/orders.zmdb.generated.js	1
compiler-fixture	fixtures/consumer-cli/src/orders.zmdb.witness.ts	3
compiler-config	packages/zmdb/src/config/index.zmdb.generated.d.ts	1
compiler-config	packages/zmdb/src/config/index.zmdb.generated.js	1
compiler-config	packages/zmdb/src/config/index.zmdb.witness.ts	2
```

The target oracle scans generated `.js`, declarations and witnesses. It rejects `@zmdb/compiler`, `typescript`, `oxlint`, Metro, bundlers, Node built-ins, old tooling subpaths and private
`packages/*/src` imports. Runtime assertion code imports `@zmdb/aot-validator/errors`; witnesses retain only original source type/callee imports.

## 8. Documentation migration set

The current old tooling names/commands occur in **44 docs-site pages**:

```text
docs-site/content/aot-setup.md
docs-site/content/cli-check.md
docs-site/content/cli-codegen.md
docs-site/content/cli-export.md
docs-site/content/cli-generate.md
docs-site/content/cli-migrate.md
docs-site/content/cli-overview.md
docs-site/content/cli-pull.md
docs-site/content/cli-push.md
docs-site/content/cli-studio.md
docs-site/content/cli-up.md
docs-site/content/config-file.md
docs-site/content/configuration.md
docs-site/content/connect-pglite.md
docs-site/content/connect-react-native.md
docs-site/content/connect-sqlite.md
docs-site/content/connect-xata.md
docs-site/content/deploy-encore.md
docs-site/content/dialect-gel.md
docs-site/content/dialect-sqlite.md
docs-site/content/guide-local-postgres.md
docs-site/content/guide-vector-search.md
docs-site/content/installation.md
docs-site/content/jit-vs-aot.md
docs-site/content/lint-rules.md
docs-site/content/migrate-from-mikro-orm.md
docs-site/content/migrate-from-prisma.md
docs-site/content/migrate-from-sequelize.md
docs-site/content/migrations-cli.md
docs-site/content/migrations-custom.md
docs-site/content/migrations-web-mobile.md
docs-site/content/migrations.md
docs-site/content/naming-strategy.md
docs-site/content/schema-first.md
docs-site/content/stored-routines.md
docs-site/content/testing.md
docs-site/content/transactional-outbox.md
docs-site/content/tutorial-blog-api.md
docs-site/content/web-cli-apps.md
docs-site/content/web-cli-monorepo.md
docs-site/content/web-cli.md
docs-site/content/web-devtools.md
docs-site/content/web-microservices-grpc.md
docs-site/content/web-repl.md
```

The docs implementation also audits `README.md`, `PUBLISHING.md`, `docs-site/content/package-reference.md`, and the READMEs for `aot-validator`, `query-compiler`, `zmdb`, `compiler`, `migrations` and
`cli`. The docs slice removes old implementation-package tooling imports and explains one product story through stable `zmdb/*` concern subpaths. Compatibility and removal notes follow the
release-governance plan rather than inventing a second policy here.

## 9. Manifest, verifier and release migration

### 9.1 Exact manifest set

The implementation changes these seven manifests and no runtime-package manifest outside this set:

```text
package.json	retarget repository fixture commands; packages/* already discovers the three new workspaces
packages/aot-validator/package.json	remove compiler exports, compiler peers and zmdb-codegen
packages/query-compiler/package.json	remove lifecycle exports and oxfmt
packages/zmdb/package.json	remove its bin implementation; retain/add product facades; add @zmdb/cli, @zmdb/compiler and @zmdb/migrations
packages/compiler/package.json	add compiler exports, peers and dependencies
packages/migrations/package.json	add lifecycle exports and dependencies
packages/cli/package.json	add the sole zmdb bin, required tooling dependencies and optional command peers
```

`yarn.lock` is regenerated from those manifest edits. `tsconfig.build.json` replaces the old tooling paths with the three new package declarations. The three new manifests, product-catalog rows and
architecture-policy rows are admitted atomically as required by #618/#722. No manifest adds a permanent implementation-owner compatibility export, a second binary or a runtime-to-tooling dependency.

### 9.2 Exact verifier and repository-tool set

Seven current verifier files contain old tooling paths or ownership assumptions and must be migrated:

```text
.github/scripts/verify-build-budget.mjs
.github/scripts/verify-escape-hatches.mjs
.github/scripts/verify-exports.mjs
.github/scripts/verify-no-defineschema.mjs
.github/scripts/verify-one-walker.mjs
.github/scripts/verify-publish.mjs
.github/scripts/verify-tf-coverage.mjs
```

The repository-level callers and adapters that must move with them are:

```text
package.json
scripts/codemod-tagged-schema.mjs
scripts/zmdb-lint-plugin.mjs
tsconfig.build.json
.github/workflows/ci.yml
```

`scripts/build-package.mjs` has a comment naming `zmdb-codegen`; it changes with the executable migration even though its generic build behavior does not. Historical issue-closing scripts and roadmap
source are records, not executable compatibility paths, and are not rewritten to pretend the old tree never existed.

### 9.3 Coordinated publish migration

At the measured baseline the product catalog and architecture policy freeze six admitted packages. Once the three tooling manifests are admitted, `releasePlan(root)` derives this nine-package
topological witness using catalog id as the tie-breaker:

```text
query-compiler
migrations
schema-core
aot-validator
compiler
repository
web
cli
zmdb
```

The order satisfies §4 plus the existing product edges. It is measured review evidence, not a second release-order authority: workflows and helpers consume `releasePlan(root).publishOrder`, whose
membership comes from `scripts/product/catalog.mjs` and whose order comes from `scripts/architecture/policy.mjs`. Package npm names are read from the catalog rather than synthesized as
`@zmdb/<directory>`, because the final entry is the unscoped `zmdb` package.

The hard-coded release surfaces that must change are:

```text
.github/scripts/lib/publish-manifest.mjs
.github/scripts/prepare-publish.mjs
.github/scripts/verify-publish.mjs
.github/workflows/publish.yml
PUBLISHING.md
```

`.github/scripts/repoint-dist.mjs` consumes the shared release plan and must not grow another list. Establishing Trusted Publisher access for a new npm name follows PUBLISHING.md's one-time setup and
is an admission prerequisite, not permission for a partial product release. Once admitted, all nine packages use one version, root changelog section, exact tag and policy-derived publish order.

The release gate installs only tarballs outside the workspace and proves:

1. all admitted manifests carry the coordinated version and workspace dependencies were rewritten to installable ranges;
2. the `zmdb` tarball installs `@zmdb/cli` and exposes exactly one `node_modules/.bin/zmdb`;
3. `zmdb/compiler`, `zmdb/migrations`, `zmdb/cli` and `zmdb/config` are identity facades over independently importable tooling packages;
4. old implementation-owner subpaths and `zmdb-codegen` agree with the compatibility/removal state recorded by the release plan;
5. optional CLI commands fail with the specified diagnostic when their optional peers are absent; and
6. the regenerated benchmark/fixture artifacts use only the emitted-runtime boundary in §7.

The target has no permanent implementation-owner forwarders. Stable product facade entries remain, while alias deprecation/removal timing is owned exclusively by #721/#728 and documented in the single
coordinated changelog.

## 10. Verifier requirements

The executable verifier derived from this policy must:

1. prove the current or migrated source catalog is bijective;
2. prove the package dependency graph is acyclic and contains no runtime-to-tooling edge;
3. prove exactly one `zmdb` bin and zero `zmdb-codegen` bins;
4. reject every old owner export/import whose release-plan state is removed, and reject any compatibility alias that owns new behavior;
5. walk generated imports and the embedded-runner graph;
6. pack each tooling package and test it outside the workspace; and
7. report catalog counts in its success output so a claim can be copied only after it was measured.
