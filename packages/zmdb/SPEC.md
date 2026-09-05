# SPEC — the `zmdb` product facade

Issue #618 freezes the public product boundary before #619–#624 change exports, configuration consumers, generated product metadata, packed fixtures, or documentation. This document deliberately
separates the surface measured at `44d8fa4a` from the target surface. Nothing in this issue changes runtime source or a package manifest.

## 1. Measured baseline

`packages/zmdb/package.json` currently declares 13 export-map entries: the root plus 12 named subpaths. Importing the root in an isolated Node process exposes 42 runtime names. Static inspection of
`src/index.ts` adds 32 type-only names, for 74 root symbols in total.

### 1.1 Every current root symbol

The classifications below describe product disposition, not whether the symbol is useful. A public symbol classified as `internal` is an implementation leak that must leave the facade; it is not
silently made private by this spec.

| Classification      | Count | Current root symbols                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application default |    18 | `schemaOf`, `Entity`, `CreateDTO`, `UpdateDTO`, `PrimaryKeyOf`, `ValidationIssue`, `is`, `assert`, `validate`, `AssertError`, `ValidateResult`, `BaseRepository`, `defineRepository`, `IncompleteKeyError`, `ValidationError`, `Driver`, `UpdatePatch`, `UpsertOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Advanced runtime    |    48 | `defineStateTransitions`, `defineEntityStateMachine`, `createStateUpdatePayload`, `CoreSchema`, `TaggedSchema`, `ColumnMeta`, `StateTransitions`, `AllowedTargetStates`, `StateUpdateDTO`, `EntityStateMachineOptions`, `EntityStateMachine`, `appendComment`, `coalesce`, `concat`, `serializeComment`, `withComments`, `createQueryCompiler`, `dec`, `inc`, `mul`, `not`, `proposed`, `UnsupportedFeatureError`, `ColumnExpr`, `CommentKey`, `CommentKeys`, `CommentPairs`, `CompiledQuery`, `Dialect`, `SetValue`, `equals`, `isShallow`, `assertShallow`, `assertEquals`, `random`, `validateShallow`, `tags`, `toJsonSchema`, `JsonSchemaObject`, `createTransactionalDb`, `batch`, `TransactionContext`, `TransactionState`, `ActiveTransactionContext`, `ClosedTransactionContext`, `TransactionalDb`, `TxConnection`, `NumericColumnOf` |
| Tooling             |     1 | `migrations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Integration         |     3 | `protoDecode`, `protoDescriptor`, `protoEncode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Internal            |     4 | `sanitizeKeys`, `chunkArray`, `DIALECT_PARAM_LIMITS`, `markTransactionClosed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The sum is the inventory assertion: `18 + 48 + 1 + 3 + 4 = 74`. #619 must turn that review-time measurement into an executable exact-export test.

### 1.1.1 Protobuf extraction amendment (#656)

The three integration names above are a historical baseline measurement. They are no longer root exports: `protoDecode`, `protoDescriptor`, and `protoEncode`, together with the gRPC artifact calls and
types, are owned only by `@zmdb/protobuf`. The product root does not forward optional protocol packages.

### 1.2 Every current named subpath

| Current subpath       | Classification      | Target concern / disposition                                                                 |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `zmdb/tags`           | Application default | Root for the common declaration vocabulary; complete vocabulary under `zmdb/schema`          |
| `zmdb/derive`         | Application default | Root for common DTOs; complete derivation family under `zmdb/schema`                         |
| `zmdb/dto`            | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/relations`      | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/ir`             | Advanced runtime    | `zmdb/schema`                                                                                |
| `zmdb/drivers/sqlite` | Integration         | Stable technology-selected integration subpath                                               |
| `zmdb/drivers/pg`     | Integration         | Stable technology-selected integration subpath                                               |
| `zmdb/drivers/mssql`  | Integration         | Stable technology-selected integration subpath                                               |
| `zmdb/web`            | Advanced runtime    | Stable complete web surface                                                                  |
| `zmdb/unplugin`       | Tooling             | `zmdb/compiler`; the old spelling may remain only as a release-governed compatibility alias  |
| `zmdb/cli`            | Tooling             | Stable programmatic CLI boundary; the executable remains `zmdb`                              |
| `zmdb/config`         | Tooling contract    | Stable canonical project-config boundary; its implementation package is intentionally hidden |

Compatibility aliases may remain until release governance chooses a breaking release, but they do not own new APIs and the beginner documentation does not teach them. Removing or deprecating an alias
is a versioning decision owned by #721/#728, not by the catalog.

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
Get, Post, Put, Patch, Delete, Body, Public
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
App, Ctx, ModuleClass
```

`Body` is part of the frozen application contract even though the measured baseline has no such root export. #619 therefore freezes it as missing behavior and #620 supplies it. Conversely, every
measured root symbol absent from the two lists above moves to the concern subpath named below or leaves the facade if it is classified as internal.

Adding a root name requires all of the following:

1. It is used by the packed one-install application rather than only by an advanced example.
2. Its owner and facade visibility exist in the product catalog.
3. It does not widen root import reachability beyond the eager-import rules.
4. Its runtime identity and type inference are tested at the `zmdb` boundary.

## 3. Frozen concern subpaths

The product taxonomy is user-facing; it does not mirror whichever workspace package currently implements a concern.

| Product subpath          | Owns                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `zmdb/config`            | `defineConfig`, discovery, loading, validation, resolution, and all config types                               |
| `zmdb/schema`            | Complete tag, derivation, DTO, relation, IR, JSON Schema, and schema-state surfaces                            |
| `zmdb/sql`               | Direct query compiler, expressions, comments, SQL errors, and compiled-query types                             |
| `zmdb/validator`         | Advanced validation, shallow checks, equality, random generation, serialization, and protocol codecs           |
| `zmdb/orm`               | Advanced repository, transaction, replica, loader, cache, hook, and repository-error surfaces                  |
| `zmdb/web`               | Complete framework surface beyond the small root bootstrap/decorator vocabulary                                |
| `zmdb/compiler`          | AOT transformer, code generation, bundler adapters, Metro adapter, and compiler-backed lint/reflection tooling |
| `zmdb/migrations`        | Snapshot, diff, file, embedded-runner, live-runner, and migration-command APIs                                 |
| `zmdb/testing`           | Product-level test app, validator/compiler helpers, fixtures, and test-only inspection                         |
| `zmdb/cli`               | Programmatic command runner and command result/error types                                                     |
| `zmdb/drivers/<name>`    | Database technology selected by the application; currently `sqlite`, `pg`, and `mssql`                         |
| `zmdb/integrations/<id>` | Optional external technology whose dependency must not be reachable from any other product entry point         |

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

The package manifest no longer owns a bin target: depending on `@zmdb/cli` is what links the one installed `zmdb` executable. Advanced implementation-package imports remain available, but normal
product documentation teaches the stable `zmdb/*` vocabulary.

`zmdb/unplugin` is not a second compiler owner. Its compatibility lifetime, and the removal timing of old AOT/query-compiler tooling subpaths and `zmdb-codegen`, are release-governance decisions under
#721/#728. The target contains no permanent implementation forwarders; stable product facade modules are part of the product contract rather than compatibility shims.

## 8. Server facade target (#645)

This section freezes the app/web/jobs facade before implementation. It composes with the one-product facade contract; it does not add runtime logic to `packages/zmdb`.

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

zmdb/jobs
zmdb/jobs/memory
zmdb/jobs/schedule
```

Optional integrations are not pulled into `zmdb` or these subpaths. A consumer chooses and installs `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`,
`@zmdb/jobs-postgres` or `@zmdb/otel` explicitly.

### Curated root additions

The app/web/jobs target adds or reassigns exactly these application-default server values at `zmdb`:

```text
Command
Container
Controller
Cron
Delete
EventPattern
Gateway
Get
Inject
Interval
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
createMemoryJobStore
createQueue
createScheduler
createToken
createWorker
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
MemoryJobStore
ModuleClass
Observability
Queue
Scheduler
Token
TransportStrategy
WebApplication
WebApplicationOptions
WebRequest
WebResponse
Worker
```

Names already frozen in §2 remain part of the root contract even when they are not repeated here; in particular this target does not remove `Body` or `App`. All other app/web/jobs names remain
available through the concern subpaths above. Optional integration names never appear at the root.

### Collision and identity rules

- Root and each facade file enumerate exports; `export *` remains forbidden.
- A public name has one canonical declaration owner. If two package surfaces propose the same name, the root either selects one canonical symbol explicitly or exposes both only through their concern
  subpaths. It does not rename, wrap or let source order choose a winner.
- Every runtime value imported from `zmdb/app`, `zmdb/web`, `zmdb/jobs` or the curated root is `===` the direct package value.
- Every class and error preserves `instanceof` across direct and facade imports because the facade never subclasses or reconstructs it.
- Type exports are direct aliases to the canonical declaration, not copied interfaces.
- The root cannot eagerly reach CLI/compiler code, TypeScript, benchmark/devtools modules, jobs unless a root jobs symbol is imported by the bundler, or any optional integration. Import-graph tests
  enforce this.

### Old paths and migration

`zmdb/web` becomes HTTP-only. Moved names are reached through `zmdb/app` or `zmdb/jobs`; old nested `zmdb/web/*` app/jobs paths are deleted with their direct-package counterparts. There are no
compatibility files, aliases, deprecation warnings or fallback resolution.

### Packed-consumer evidence

A consumer fixture must install packed tarballs outside the workspace and:

1. build one SQLite HTTP application using only `zmdb`, including module/DI, a controller, validation, a repository and `createApp`;
2. build one app extension and one memory-backed worker using `zmdb/app` and `zmdb/jobs`;
3. import every facade subpath above;
4. assert runtime identity between direct package, concern facade and curated-root values;
5. assert old moved paths and optional integration names do not resolve;
6. inspect the installed dependency tree and prove app/web/jobs introduce no third-party runtime peer.
