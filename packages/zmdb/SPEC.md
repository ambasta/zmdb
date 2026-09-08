# SPEC — the `zmdb` product facade

The `zmdb` facade presents the application workflow through current public owners. Its root and concern boundaries follow.

## 1. Current authority and refusals

The [manifest](./package.json), [root entry](./src/index.ts), and [product catalog](../../scripts/product/catalog.mjs) define the implemented exports and their owners. The current default SQLite
journey is specified below; the old measured root and subpath inventories are preserved in [ADR 0004](../../docs/adr/0004-package-and-product-baselines.md).

`protoDecode`, `protoDescriptor`, and `protoEncode`, together with the gRPC artifact calls and types, are owned only by `@zmdb/protobuf`. The product root does not forward optional protocol packages.
Historical inventory and compatibility-alias statements do not authorize additional public entries.

## 2. Frozen target root

The root is the deliberate application vocabulary. It contains no wildcard exports and no implementation algorithm. Each value is re-exported by identity from the narrow module that owns it; each type
is a type-only re-export.

The exact required root values are:

```text
defineConfig
schemaOf
is, assert, validate
defineRepository
createApp, Module, Controller
Get, Post, Put, Patch, Delete, Public
AssertError, ValidationError, IncompleteKeyError
```

The exact required root types are:

```text
ZmdbConfig
Table, Physical, Sql, PrimaryKey, Serial, Unique, HasDefault, Sensitive, References
Min, Max, MinLength, MaxLength, Pattern
Entity, CreateDTO, UpdateDTO, ReadDTO, PrimaryKeyOf
Driver, UpdatePatch
ValidateResult, ValidationIssue
WebApplication, Ctx, ModuleClass
```

#619 listed `Body` without a declaration owner or callable contract. That inventory was false: this project uses Stage-3 decorators, which have no parameter decorators, and HTTP handlers receive a
typed `Ctx` whose `body` property carries the request value. #620 corrects the frozen list instead of publishing a no-op or legacy-decorator-shaped value. Every measured root symbol absent from the
two lists above moves to the concern subpath named below or leaves the facade if it is classified as internal.

Adding a root name requires all of the following:

1. It is used by the packed one-install application rather than only by an advanced example.
2. Its owner and facade visibility exist in the product catalog.
3. It does not widen root import reachability beyond the eager-import rules.
4. Its runtime identity and type inference are tested at the `zmdb` boundary.

## 3. Frozen concern subpaths

The product taxonomy is user-facing; it does not mirror whichever workspace package currently implements a concern.

| Product subpath          | Owns                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zmdb/config`            | `defineConfig`, discovery, loading, validation, resolution, and all config types                                                                             |
| `zmdb/schema`            | Complete tag, derivation, DTO, relation, IR, JSON Schema, and schema-state surfaces                                                                          |
| `zmdb/sql`               | Direct query compiler, expressions, comments, SQL errors, and compiled-query types                                                                           |
| `zmdb/validator`         | Advanced validation, shallow checks, equality, random generation, serialization, and protocol codecs                                                         |
| `zmdb/orm`               | Advanced repository, transaction, replica, loader, cache, hook, and repository-error surfaces                                                                |
| `zmdb/web`               | Complete framework surface beyond the small root bootstrap/decorator vocabulary                                                                              |
| `zmdb/compiler`          | Configured AOT plugin, code generation, direct transform, and compiler-backed lint/reflection tooling; Metro is selected only through `@zmdb/compiler/metro` |
| `zmdb/migrations`        | Snapshot, diff, file, embedded-runner, live-runner, and migration-command APIs                                                                               |
| `zmdb/testing`           | Product-level test app, validator/compiler helpers, fixtures, and test-only inspection                                                                       |
| `zmdb/cli`               | Programmatic command runner and command result/error types                                                                                                   |
| `zmdb/<database>`        | Explicit database product selected by the application: `sqlite`, `postgres`, `mysql`, `mssql`, `cockroach`, or `singlestore`                                 |
| `zmdb/integrations/<id>` | Optional external technology whose dependency must not be reachable from any other product entry point                                                       |

The root and these subpaths are the stable product entry points. Canonical implementation may move between `@zmdb/*` packages without changing consumer imports. Workspace packages remain independently
installable dependency firebreaks, but their names are advanced architecture, not the application vocabulary.

## 4. Eager-import prohibition

Importing `zmdb` may reach only the narrow runtime modules needed by the frozen root. It must not load or resolve:

- the CLI, config discovery/loader, compiler, code generator, migration filesystem runner, Studio, or devtools;
- `typescript`, `oxfmt`, `esbuild`, or another build tool;
- an optional database client, broker client, telemetry SDK, frontend framework, transport, or native binding;
- a broad package barrel when a narrower owner module avoids any of the above.

`defineConfig` at the root is therefore re-exported from a dependency-free contract module. The full `zmdb/config` entry may load filesystem and compiler services only after a consumer explicitly
imports it. The root web names are re-exported from narrow app, module, routing, and context modules rather than from a barrel that also initializes transports or optional integrations.

#619 freezes these rules with two process boundaries:

1. Import `zmdb`, capture the loaded module graph, and reject every forbidden module or package.
2. Import each tooling or integration subpath explicitly and prove that its reachability is confined to that subpath.

The existing identity checks remain necessary but are not sufficient: a re-export can have the correct identity and still eagerly load an unrelated tool.

## 5. Facade implementation rule

Files that implement the product facade contain only:

- named `export` and `export type` declarations;
- comments and type declarations that emit no mutable runtime state.

They do not contain query compilation, validation, reflection, migration, driver, routing, configuration discovery, filesystem access, caches, mutable registries, functions, classes, or application
algorithms. A dependency-free contract module may implement the `defineConfig` identity helper; the facade only re-exports it. #620 adds a static verifier for this rule. The existing config loader and
CLI are product-owned capabilities, but they are not facade modules and remain behind explicit subpaths.

## 6. Acceptance ownership

- #619 freezes exact root/type imports, concern subpaths, module reachability, config sharing, catalog generation, and the packed external journey.
- #620 implements the facade and eager-import boundary.
- #621 makes `zmdb/config` the only project-config owner.
- #622 owns the canonical product catalog and its generated or verified consumers.
- #623 proves the packed one-install SQLite HTTP journey.
- #624 rewrites beginner documentation from that measured fixture.
- #721/#728 exclusively own versioning, changelog, tags, publish order, compatibility/deprecation timing, and partial-release behavior.

## 7. Tooling implementation-package extraction (#626)

Issue #626 refines the implementation ownership under the stable product surface above; it does not supersede the one-product facade.

`@zmdb/cli` owns the sole `zmdb` executable and command implementation, `@zmdb/compiler` owns the TypeScript/config implementation, and `@zmdb/migrations` owns generic schema-lifecycle tooling. The
product package:

- depends on all three tooling packages but keeps their modules unreachable from the root;
- exposes `zmdb/cli`, `zmdb/compiler`, `zmdb/migrations` and `zmdb/config` as identity concern facades;
- removes its own CLI, config-loader, compiler, migration, Studio and scaffolding implementations;
- removes the root `migrations` namespace rather than making tooling eagerly reachable; and
- preserves a dependency-free root `defineConfig` contract without loading filesystem-backed config code.

#628, #629 and #630 implement the compiler/config, migration and CLI owners respectively. The product manifest depends on those packages and exposes their identity facades. `zmdb/cli` re-exports
`@zmdb/cli`; command dispatch, Studio and scaffolding live in that package, and `zmdb` has no executable entry of its own. Advanced implementation-package imports remain available, while normal
product documentation uses the stable `zmdb/*` vocabulary.

`zmdb/unplugin`, the old AOT compiler and query-compiler migration subpaths, and `zmdb-codegen` are absent. The configured plugin implementation belongs only to the compiler root. `zmdb/compiler`
excludes Metro's `getCacheKey`, `transform`, `withZmdb` and `MetroOptions`; the existing explicit `@zmdb/compiler/metro` entry retains that optional adapter. Migration `runCli` is removed from the
engine and product entries; `up`, `down` and `status` remain. Stable product concerns retain named identities with no compatibility alias or duplicated implementation.

## 8. Default server facade and selected jobs (#645, #651, #755)

The product facade includes the application kernel and HTTP concerns. Background jobs remain a first-party product capability, but selecting them is an installation choice rather than a mandatory
`zmdb` dependency.

### Product subpaths

The facade mirrors every stable core-server entry with an explicit re-export:

```text
zmdb/app
zmdb/app/commands
zmdb/app/cqrs
zmdb/app/data
zmdb/app/di
zmdb/app/events
zmdb/app/health
zmdb/app/lifecycle
zmdb/app/messaging
zmdb/app/modules
zmdb/app/observability
zmdb/app/state

zmdb/web
zmdb/web/app
zmdb/web/compression
zmdb/web/context
zmdb/web/contract
zmdb/web/contract/compiler
zmdb/web/csrf
zmdb/web/data
zmdb/web/devtools
zmdb/web/dto-pipes
zmdb/web/gateways
zmdb/web/health
zmdb/web/middleware
zmdb/web/openapi
zmdb/web/pipeline
zmdb/web/routing
zmdb/web/static
zmdb/web/testing
zmdb/web/upload
zmdb/web/versioning
```

There is no `zmdb/jobs`, `zmdb/jobs/memory`, or `zmdb/jobs/schedule` export. Consumers install `@zmdb/jobs` directly and add any storage provider explicitly. Optional transports, telemetry, and
durable job providers are likewise not pulled into `zmdb`.

### Curated root additions

The app/web target adds or reassigns exactly these application-default server values at `zmdb`:

```text
Command
Container
Controller
Delete
EventPattern
Gateway
Get
Inject
MessagePattern
Module
OnEvent
Patch
Post
Public
Put
Subscribe
Version
VersionNeutral
createApp
createApplication
createCommandApp
createEvents
createToken
repositoryToken
```

It adds or reassigns exactly these application-default server types at the root:

```text
Application
ApplicationExtension
ApplicationExtensionContext
ApplicationOptions
CommandApp
Ctx
ModuleClass
Observability
Token
TransportStrategy
WebApplication
WebApplicationOptions
WebRequest
WebResponse
```

Names already frozen in §2 remain part of the root contract even when they are not repeated here; in particular this target retains `WebApplication`. `Body` is deliberately absent for the reason
measured in §2. Other app/web names remain available through the concern subpaths above. Job names remain available only from `@zmdb/jobs` and its package-owned subpaths.

### Collision and identity rules

- Root and each facade file enumerate exports; `export *` remains forbidden.
- A public name has one canonical declaration owner. If two package surfaces propose the same name, the root either selects one canonical symbol explicitly or exposes both only through their concern
  subpaths. It does not rename, wrap or let source order choose a winner.
- Every runtime value imported from `zmdb/app`, `zmdb/web`, or the curated root is `===` the direct package value. Job providers compose the direct `@zmdb/jobs` identities.
- Every class and error preserves `instanceof` across direct and facade imports because the facade never subclasses or reconstructs it.
- Type exports are direct aliases to the canonical declaration, not copied interfaces.
- The root cannot eagerly reach CLI/compiler code, TypeScript, benchmark/devtools modules, jobs, a jobs provider, a Node built-in, or any optional integration. Import-graph tests enforce this.

### Old paths and migration

`@zmdb/web` remains HTTP-only. The product-level `zmdb/web` entry composes the `@zmdb/app` and `@zmdb/web` roots by identity. Replace any alpha-era `zmdb/jobs` import with `@zmdb/jobs` and
`zmdb/jobs/schedule` with `@zmdb/jobs/schedule`; there is no compatibility forwarder, dynamic fallback, or duplicated implementation.

### Packed-consumer evidence

A consumer fixture must install packed tarballs outside the workspace and:

1. build one SQLite HTTP application using only `zmdb`, including module/DI, a controller, validation, a repository and `createApp`;
2. import and strict-typecheck every direct app/web entry and every default facade counterpart above;
3. assert runtime identity between direct package, concern facade, and curated-root values;
4. serve one HTTP request and run one command with no jobs package installed;
5. assert `zmdb/jobs*`, old `zmdb/drivers/*` paths, and optional integration names do not resolve;
6. inspect the installed dependency tree and prove the default product has no jobs edge and selects SQLite as its only required database package;
7. separately pack `@zmdb/jobs`, typecheck its package-owned entries, and run `jobsExtension` through the real application lifecycle.

## 10. Default SQLite installed journey (#623)

The `zmdb` manifest installs `@zmdb/sqlite` as an ordinary dependency so an application can use `zmdb/sqlite` after installing only the product. SQLite remains behind that explicit subpath and is not
eagerly imported from the root. Other database and technology integrations retain their optional peers. The historical baseline tables above remain historical.

`fixtures/consumer-product` proves the default journey with actual published archives and npm install/ci: strict public types, canonical config, CLI-generated migration, the public AOT compiler, real
loopback HTTP CRUD and owned-resource cleanup. Its eight named assertions share one installed run. It does not manually extract packages, link workspace tools, or substitute a handwritten migration.
Optional integrations are qualified by their independent children.
