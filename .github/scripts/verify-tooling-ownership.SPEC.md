# Tooling ownership policy — verifier contract

> Status: **FROZEN** for GitHub sub-issue #626, amended by #627 after #667 added database-boundary test support, remeasured for #681, amended by #656 after the protobuf runtime/public-owner
> extraction, remeasured for #668 after the generic dialect protocol/type split, amended by #669 for the SQLite owner move, amended by #685 for the generated-client command and its CLI fixtures, and
> amended by #621 for the dependency-light config authoring contract. Issue #629 updates the measured ownership after migrations moved to their target package, #651 adds the cohesive app, web and jobs
> product facades, and #620 adds the remaining product concern facades.

## 1. Extraction rule and totals

The shipped/build-input source inventory is every file below `packages/{aot-validator,compiler,migrations,query-compiler,zmdb}/src` whose extension is `.ts`, `.js`, `.json` or `.proto`, plus
`packages/schema-core/src/ir/{validation-shape,vocabulary}.ts`, excluding `SPEC.md`, `*.spec.ts` and `*.type-test.ts`. Checked-in declarations, generated JavaScript, witnesses and fixture data count
because the publish manifest ships `src` and the build consumes or copies them.

The inventory has **215 paths**, each exactly once:

```json
{
  "compiler": 33,
  "migrations": 21,
  "cli": 31,
  "runtime": 30,
  "facade": 62,
  "optional-integration": 0,
  "test-only": 38,
  "obsolete": 0
}
```

An ownership verifier must fail on an omitted current path, a path in two groups, a catalog path that no longer exists, or a changed total without an intentional edit to this policy.

## 2. Exact source move map

The line grammar is `<target-owner><TAB><current-path>`.

```text
compiler	packages/compiler/src/codegen/index.ts
compiler	packages/compiler/src/codegen/scan.ts
compiler	packages/compiler/src/codegen/witness.ts
compiler	packages/compiler/src/config/index.ts
compiler	packages/compiler/src/config/index.zmdb.generated.d.ts
compiler	packages/compiler/src/config/index.zmdb.generated.js
compiler	packages/compiler/src/config/index.zmdb.witness.ts
compiler	packages/compiler/src/emit/__testing__/project.ts
compiler	packages/compiler/src/emit/index.ts
compiler	packages/compiler/src/errors.ts
compiler	packages/compiler/src/index.ts
compiler	packages/compiler/src/lint/ast.ts
compiler	packages/compiler/src/lint/host-types.ts
compiler	packages/compiler/src/lint/index.ts
compiler	packages/compiler/src/lint/rules/no-distributed-nullable-tags.ts
compiler	packages/compiler/src/lint/rules/no-empty-patch.ts
compiler	packages/compiler/src/lint/rules/no-interpolated-sql.ts
compiler	packages/compiler/src/lint/rules/no-unbounded-find.ts
compiler	packages/compiler/src/lint/rules/no-unknown-json-column.ts
compiler	packages/compiler/src/lint/rules/require-sql-on-number.ts
compiler	packages/compiler/src/lint/types.ts
compiler	packages/compiler/src/metro/metro.ts
compiler	packages/compiler/src/protobuf/decode.ts
compiler	packages/compiler/src/protobuf/descriptor.ts
compiler	packages/compiler/src/protobuf/encode.ts
compiler	packages/compiler/src/protobuf/grpc-ir.ts
compiler	packages/compiler/src/reflect/callsites.ts
compiler	packages/compiler/src/reflect/index.ts
compiler	packages/compiler/src/reflect/session.ts
compiler	packages/compiler/src/testing/index.ts
compiler	packages/compiler/src/transform/index.ts
compiler	packages/compiler/src/unplugin/index.ts
compiler	packages/compiler/src/unplugin/inline-bench.ts
migrations	packages/migrations/src/declarations/emit.ts
migrations	packages/migrations/src/declarations/index.ts
migrations	packages/migrations/src/declarations/tagged-property.ts
migrations	packages/migrations/src/embedded.ts
migrations	packages/migrations/src/file-io.ts
migrations	packages/migrations/src/files.ts
migrations	packages/migrations/src/index.ts
migrations	packages/migrations/src/introspect/common.ts
migrations	packages/migrations/src/introspect/drift.ts
migrations	packages/migrations/src/introspect/index.ts
migrations	packages/migrations/src/operations/check.ts
migrations	packages/migrations/src/operations/embed.ts
migrations	packages/migrations/src/operations/export.ts
migrations	packages/migrations/src/operations/generate.ts
migrations	packages/migrations/src/operations/migrate.ts
migrations	packages/migrations/src/operations/pull.ts
migrations	packages/migrations/src/operations/push.ts
migrations	packages/migrations/src/operations/upgrade.ts
migrations	packages/migrations/src/project.ts
migrations	packages/migrations/src/runner.ts
migrations	packages/migrations/src/testing.ts
cli	packages/zmdb/src/cli/args.ts
cli	packages/zmdb/src/cli/atomic.ts
cli	packages/zmdb/src/cli/bin.ts
cli	packages/zmdb/src/cli/commands/check.ts
cli	packages/zmdb/src/cli/commands/client.ts
cli	packages/zmdb/src/cli/commands/embed.ts
cli	packages/zmdb/src/cli/commands/export.ts
cli	packages/zmdb/src/cli/commands/generate.ts
cli	packages/zmdb/src/cli/commands/migrate.ts
cli	packages/zmdb/src/cli/commands/new.ts
cli	packages/zmdb/src/cli/commands/pull.ts
cli	packages/zmdb/src/cli/commands/push.ts
cli	packages/zmdb/src/cli/commands/studio.ts
cli	packages/zmdb/src/cli/commands/upgrade.ts
cli	packages/zmdb/src/cli/config.ts
cli	packages/zmdb/src/cli/database.ts
cli	packages/zmdb/src/cli/errors.ts
cli	packages/zmdb/src/cli/index.ts
cli	packages/zmdb/src/cli/migration-project.ts
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
runtime	packages/compiler/src/config/contract.ts
runtime	packages/query-compiler/src/aggregations/index.ts
runtime	packages/query-compiler/src/clauses.ts
runtime	packages/query-compiler/src/comments/index.ts
runtime	packages/query-compiler/src/compiled-query.ts
runtime	packages/query-compiler/src/dialects/index.ts
runtime	packages/query-compiler/src/dialects/protocol.ts
runtime	packages/query-compiler/src/errors.ts
runtime	packages/query-compiler/src/expressions/index.ts
runtime	packages/query-compiler/src/extensions/index.ts
runtime	packages/query-compiler/src/fts/index.ts
runtime	packages/query-compiler/src/index.ts
runtime	packages/query-compiler/src/introspect/types.ts
runtime	packages/query-compiler/src/joins/index.ts
runtime	packages/query-compiler/src/migrations/types.ts
runtime	packages/query-compiler/src/naming/index.ts
runtime	packages/query-compiler/src/outbox/index.ts
runtime	packages/query-compiler/src/quoting.ts
runtime	packages/query-compiler/src/schema-objects/extensions.ts
runtime	packages/query-compiler/src/schema-objects/index.ts
runtime	packages/query-compiler/src/schema-objects/types.ts
runtime	packages/query-compiler/src/set-ops/index.ts
runtime	packages/schema-core/src/ir/validation-shape.ts
runtime	packages/schema-core/src/ir/vocabulary.ts
facade	packages/zmdb/src/app-commands.ts
facade	packages/zmdb/src/app-cqrs.ts
facade	packages/zmdb/src/app-data.ts
facade	packages/zmdb/src/app-di.ts
facade	packages/zmdb/src/app-events.ts
facade	packages/zmdb/src/app-health.ts
facade	packages/zmdb/src/app-lifecycle.ts
facade	packages/zmdb/src/app-messaging.ts
facade	packages/zmdb/src/app-modules.ts
facade	packages/zmdb/src/app-observability.ts
facade	packages/zmdb/src/app-state.ts
facade	packages/zmdb/src/app.ts
facade	packages/zmdb/src/compiler.ts
facade	packages/zmdb/src/config/index.ts
facade	packages/zmdb/src/custom-types.ts
facade	packages/zmdb/src/derive.ts
facade	packages/zmdb/src/database-cockroach.ts
facade	packages/zmdb/src/database-mssql.ts
facade	packages/zmdb/src/database-mysql.ts
facade	packages/zmdb/src/database-postgres.ts
facade	packages/zmdb/src/database-singlestore.ts
facade	packages/zmdb/src/database-sqlite.ts
facade	packages/zmdb/src/dto.ts
facade	packages/zmdb/src/entity-modeling.ts
facade	packages/zmdb/src/index.ts
facade	packages/zmdb/src/integrations.ts
facade	packages/zmdb/src/ir.ts
facade	packages/zmdb/src/llm.ts
facade	packages/zmdb/src/migrations.ts
facade	packages/zmdb/src/openapi.ts
facade	packages/zmdb/src/orm.ts
facade	packages/zmdb/src/query.ts
facade	packages/zmdb/src/relations.ts
facade	packages/zmdb/src/replicas.ts
facade	packages/zmdb/src/schema.ts
facade	packages/zmdb/src/seeding.ts
facade	packages/zmdb/src/sql.ts
facade	packages/zmdb/src/tags.ts
facade	packages/zmdb/src/testing.ts
facade	packages/zmdb/src/transactions.ts
facade	packages/zmdb/src/unplugin.ts
facade	packages/zmdb/src/web-app.ts
facade	packages/zmdb/src/web-compression.ts
facade	packages/zmdb/src/web-context.ts
facade	packages/zmdb/src/validator.ts
facade	packages/zmdb/src/web-contract-compiler.ts
facade	packages/zmdb/src/web-contract.ts
facade	packages/zmdb/src/web-csrf.ts
facade	packages/zmdb/src/web-data.ts
facade	packages/zmdb/src/web-devtools.ts
facade	packages/zmdb/src/web-dto-pipes.ts
facade	packages/zmdb/src/web-gateways.ts
facade	packages/zmdb/src/web-health.ts
facade	packages/zmdb/src/web-middleware.ts
facade	packages/zmdb/src/web-openapi.ts
facade	packages/zmdb/src/web-pipeline.ts
facade	packages/zmdb/src/web-routing.ts
facade	packages/zmdb/src/web-static.ts
facade	packages/zmdb/src/web-testing.ts
facade	packages/zmdb/src/web-upload.ts
facade	packages/zmdb/src/web-versioning.ts
facade	packages/zmdb/src/web.ts
test-only	packages/compiler/src/lint/__fixtures__/nullable-tags.fixed.ts
test-only	packages/compiler/src/lint/__fixtures__/nullable-tags.input.ts
test-only	packages/compiler/src/lint/__fixtures__/rule-tester.ts
test-only	packages/compiler/src/lint/__fixtures__/unknown-json.input.ts
test-only	packages/compiler/src/lint/__fixtures__/unknown-json.suggested.ts
test-only	packages/compiler/src/lint/__fixtures__/valid-near-misses.ts
test-only	packages/compiler/src/protobuf/__fixtures__/reference.proto
test-only	packages/compiler/src/protobuf/__testing__/fixture.ts
test-only	packages/compiler/src/reflect/__fixtures__/codemod-corpus.ts
test-only	packages/compiler/src/reflect/__fixtures__/codemod-refusals.ts
test-only	packages/compiler/src/reflect/__fixtures__/codemod-tables.ts
test-only	packages/compiler/src/reflect/__fixtures__/constructs.ts
test-only	packages/compiler/src/reflect/__fixtures__/documents.ts
test-only	packages/compiler/src/reflect/__fixtures__/legacy-dsl.ts
test-only	packages/compiler/src/reflect/__fixtures__/naming-strategy.ts
test-only	packages/compiler/src/reflect/__fixtures__/payloads.ts
test-only	packages/compiler/src/reflect/__fixtures__/schema-values-refusals.ts
test-only	packages/compiler/src/reflect/__fixtures__/schema-values.ts
test-only	packages/compiler/src/reflect/__fixtures__/tables.ts
test-only	packages/compiler/src/reflect/__fixtures__/tsconfig.json
test-only	packages/migrations/src/introspect/__fixtures__/mysql-8.4.11.json
test-only	packages/migrations/src/testing/official-dialects.fixture.ts
test-only	packages/query-compiler/src/testing/capability-matrix.ts
test-only	packages/query-compiler/src/testing/database-vertical.ts
test-only	packages/query-compiler/src/testing/external-dialect.fixture.ts
test-only	packages/query-compiler/src/testing/official-dialects.fixture.ts
test-only	packages/zmdb/src/cli/__fixtures__/http-client/package.json
test-only	packages/zmdb/src/cli/__fixtures__/http-client/src/contract.ts
test-only	packages/zmdb/src/cli/__fixtures__/http-client/src/models.ts
test-only	packages/zmdb/src/cli/__fixtures__/http-client/src/schema.ts
test-only	packages/zmdb/src/cli/__fixtures__/http-client/src/unrelated.ts
test-only	packages/zmdb/src/cli/__fixtures__/http-client/tsconfig.json
test-only	packages/zmdb/src/cli/__fixtures__/http-client/zmdb.config.ts
test-only	packages/zmdb/src/cli/__fixtures__/project/package.json
test-only	packages/zmdb/src/cli/__fixtures__/project/src/schema.ts
test-only	packages/zmdb/src/cli/__fixtures__/project/tsconfig.json
test-only	packages/zmdb/src/cli/__fixtures__/project/zmdb.config.ts
test-only	packages/zmdb/src/testing/official-dialects.fixture.ts
```

`test-only` paths follow the concern they test when implementation moves them; they never become published public APIs. The zero counts are retained as ratchet categories: adding an
optional-integration or obsolete source path now requires an intentional policy change.

## 3. Public export and executable map

There are **77 current export keys**: 14 AOT validator, 9 query compiler and 54 facade. This count is manifest-derived. The disposition map below also retains release-governed source-owner keys after
their implementation moves, while #651's server facade keys, #620's concern facades, and #755's selected-jobs boundary are governed by `packages/zmdb/SPEC.md` and `scripts/product/catalog.mjs`.

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
zmdb	./schema	retain-product-facade	@zmdb/schema
zmdb	./sql	retain-product-facade	@zmdb/sql
zmdb	./validator	retain-product-facade	@zmdb/validator
zmdb	./orm	retain-product-facade	@zmdb/orm
zmdb	./compiler	retain-product-facade	@zmdb/compiler
zmdb	./migrations	retain-product-facade	@zmdb/migrations
zmdb	./testing	retain-product-facade	@zmdb/compiler/testing
zmdb	./tags	retain	zmdb/tags
zmdb	./ir	retain	zmdb/ir
zmdb	./derive	retain	zmdb/derive
zmdb	./dto	retain	zmdb/dto
zmdb	./relations	retain	zmdb/relations
zmdb	./sqlite	retain-product-facade	@zmdb/sqlite
zmdb	./postgres	retain-product-facade	@zmdb/postgres
zmdb	./mysql	retain-product-facade	@zmdb/mysql
zmdb	./mssql	retain-product-facade	@zmdb/mssql
zmdb	./cockroach	retain-product-facade	@zmdb/cockroach
zmdb	./singlestore	retain-product-facade	@zmdb/singlestore
zmdb	./web	retain	zmdb/web
zmdb	./web/contract	retain	@zmdb/web/contract
zmdb	./web/contract/compiler	retain	@zmdb/web/contract/compiler
zmdb	./compiler	retain-facade	@zmdb/compiler
zmdb	./unplugin	release-governed-alias	zmdb/compiler
zmdb	./cli	retain-product-facade	@zmdb/cli
zmdb	./config	retain-facade	@zmdb/compiler/config
```

Stable `zmdb/*` product facades remain while implementation ownership moves.

The one current tooling binary is:

```text
zmdb	zmdb	move-to-@zmdb/cli
```

The target repository has one bin declaration, `@zmdb/cli` → `zmdb`. The `zmdb-codegen` declaration is gone; the CLI slice will move the remaining command without creating a second owner.

## 4. Exact tooling DAG

The line grammar is `<dependency><TAB><consumer><TAB><kind>`. These are the complete workspace edges introduced or required by this tooling target:

```text
@zmdb/query-compiler	@zmdb/compiler	required
@zmdb/schema-core	@zmdb/compiler	required
@zmdb/aot-validator	@zmdb/compiler	required
@zmdb/ai	@zmdb/compiler	required
@zmdb/query-compiler	@zmdb/migrations	required
@zmdb/compiler	@zmdb/cli	required
@zmdb/migrations	@zmdb/cli	required
@zmdb/cli	zmdb	required
@zmdb/compiler	zmdb	required-product-and-config-facades
@zmdb/compiler	@zmdb/web	optional-contract-compiler
@zmdb/migrations	zmdb	required-product-facade
@zmdb/web	@zmdb/cli	optional-lazy-command
```

`@zmdb/compiler` and `@zmdb/migrations` have no edge between them. The CLI composes their public results. `@zmdb/web/contract/compiler` alone has an optional compiler peer; the web root cannot reach
it. `@zmdb/web` is not evaluated by the CLI root; it is an optional peer loaded only for selected application commands. The three tooling packages reach `zmdb` only through stable concern facades, and
none is reachable from the product root. A topological sort must contain query/schema/validator/AI protocols before compiler, compiler/migrations before CLI, and all three tooling packages before the
product facade.

## 5. Manifest-edge move map

There are **35 current dependency/peer/development edges** in the four affected manifests.

```text
packages/aot-validator/package.json	dependency	@zmdb/schema-core	retain-runtime
packages/aot-validator/package.json	dev	typescript	retain-runtime-build
packages/compiler/package.json	dependency	@zmdb/ai	retain-compiler-build-time
packages/compiler/package.json	dependency	@zmdb/aot-validator	retain-generated-runtime-abi
packages/compiler/package.json	dependency	@zmdb/query-compiler	retain-config-protocols
packages/compiler/package.json	dependency	@zmdb/schema-core	retain-reflection-ir
packages/compiler/package.json	peer	metro	retain-compiler-optional-peer
packages/compiler/package.json	peer	metro-babel-transformer	retain-compiler-optional-peer
packages/compiler/package.json	peer	oxlint	retain-compiler-optional-peer
packages/compiler/package.json	peer	typescript	retain-compiler-required-peer
packages/compiler/package.json	dev	@zmdb/protobuf	retain-compiler-boundary-tests
packages/compiler/package.json	dev	metro	retain-compiler-integration-tests
packages/compiler/package.json	dev	metro-babel-transformer	retain-compiler-integration-tests
packages/compiler/package.json	dev	oxlint	retain-compiler-lint-tests
packages/compiler/package.json	dev	protobufjs	retain-compiler-protobuf-conformance
packages/compiler/package.json	dev	typescript	retain-compiler-build
packages/query-compiler/package.json	dependency	oxfmt	move-migrations-dependency
packages/query-compiler/package.json	dev	@zmdb/compiler	retain-compiler-query-fixtures
packages/query-compiler/package.json	dev	typescript	retain-query-build
packages/zmdb/package.json	dependency	@zmdb/aot-validator	retain-facade
packages/zmdb/package.json	dependency	@zmdb/app	retain-facade
packages/zmdb/package.json	dependency	@zmdb/compiler	retain-product-and-config-facades
packages/zmdb/package.json	dependency	@zmdb/query-compiler	retain-facade
packages/zmdb/package.json	dependency	@zmdb/repository	retain-facade
packages/zmdb/package.json	dependency	@zmdb/schema-core	retain-facade
packages/zmdb/package.json	dependency	@zmdb/sqlite	retain-database-facade-until-cutover
packages/zmdb/package.json	dependency	@zmdb/web	retain-facade
packages/zmdb/package.json	dependency	esbuild	move-cli-optional-peer-and-dev
packages/zmdb/package.json	dependency	oxfmt	move-cli-dependency
packages/zmdb/package.json	dev	@zmdb/ai	retain-facade-boundary-tests
packages/zmdb/package.json	dev	@zmdb/mssql	retain-optional-facade-tests
packages/zmdb/package.json	dev	@zmdb/postgres	retain-optional-facade-tests
packages/zmdb/package.json	dev	typescript	retain-facade-build
packages/zmdb/package.json	peer	@zmdb/mssql	retain-optional-database-facade
packages/zmdb/package.json	peer	@zmdb/postgres	retain-optional-database-facade
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

`consumer-cli` historically proved the old codegen executable and now proves the compiler/no-bundler route. `consumer-plugin` and `consumer-metro` are compiler adapter fixtures. Separate packed
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
compiler-config	packages/compiler/src/config/index.zmdb.generated.d.ts	1
compiler-config	packages/compiler/src/config/index.zmdb.generated.js	1
compiler-config	packages/compiler/src/config/index.zmdb.witness.ts	2
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

The release surfaces that consume the shared catalog/policy-derived model, and must continue to do so after the tooling split, are:

```text
.github/scripts/lib/publish-manifest.mjs
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
