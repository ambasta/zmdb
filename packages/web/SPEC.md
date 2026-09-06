# `@zmdb/web` — HTTP package SPEC

> Stage-3 HTTP framework over the protocol-neutral `@zmdb/app` kernel. The original issue #248 package baseline remains below as history; issue #649's HTTP-only boundary is the current contract.

## Position in the architecture

At the original #248 baseline, `@zmdb/web` sat **above** `@zmdb/repository` in the dependency DAG (ARCHITECTURE.md §3) and depended on `@zmdb/schema-core`, `@zmdb/aot-validator`,
`@zmdb/query-compiler` and `@zmdb/repository`. The current package is the HTTP adapter over `@zmdb/app`; its direct runtime dependencies are exactly `@zmdb/app` and `@zmdb/schema-core`. It declares no
third-party runtime dependency or runtime peer. `@zmdb/compiler` and TypeScript are optional build-time peers reached only by `./contract/compiler`.

## Invariants (inherited, non-negotiable)

1. **No `as` / no `any` / no `!` on the consumer surface.** Framework internals hold to the documented, shrinking boundary-cast exception list (ARCHITECTURE.md §2.1). A user must never need an
   assertion to use `@zmdb/web`.
2. **No runtime reflection.** No `reflect-metadata`, no `emitDecoratorMetadata`. Decorators use **Stage 3** semantics and store data only in `context.metadata` (`Symbol.metadata`).
3. **Stage 3 decorators**: tsconfig sets `experimentalDecorators: false` and must compile standard decorators. `Symbol.metadata` is **not yet exposed by Node 26 / V8** (`Symbol.metadata === undefined`
   as of v26.8), so a zero-dependency polyfill installs the well-known symbol when absent (a no-op once a runtime ships it natively). It assigns only `Symbol.metadata` and mutates no other global, and
   is imported for its side effect before any decorated class is evaluated.
4. **ESM-only, Node 26+, TS 7+.** `"type": "module"`, single `exports` map, no CJS.

## Baseline contract (this issue)

### Package

- New workspace `packages/web`, name **`@zmdb/web`**, version tracks the other packages (`1.0.0-alpha.4`), license **GPL-3.0-or-later**.
- Original `dependencies`: `@zmdb/schema-core`, `@zmdb/aot-validator`, `@zmdb/query-compiler`, `@zmdb/repository` (all `workspace:^`). Integration peers belonged to the former server subpaths. The
  current HTTP-only manifest is defined in the issue #649 section below.
- `exports."."` → `./src/index.ts` (repointed to `./dist/index.js` at publish, exactly like the sibling packages).

### tsconfig

- Extends `../../tsconfig.json`.
- `rootDir`, `outDir` and the sibling `.d.ts` `paths` live in `tsconfig.build.json`, the emit project; `tsconfig.json` is `noEmit` and resolves siblings to their sources, so an edit in one package is
  a compile error here immediately.
- Explicitly asserts the decorator baseline: `experimentalDecorators: false`, `emitDecoratorMetadata: false`. (`strict` etc. come from base.)

### Build & publish wiring

- `tsconfig.build.json` mirrors `src` into `dist`; every public root and subpath is declared in the package `exports` map and repointed to emitted `.js` during publishing.
- Admitted once through `scripts/product/catalog.mjs`; release tooling maps that catalog row through architecture policy, so publish membership and dependency-first order are not repeated in package
  scripts.
- Re-exported from the `zmdb` product facade as **`zmdb/web`** (a subpath entry in `packages/zmdb`).

### Baseline symbol

- A zero-dependency **`Symbol.metadata` polyfill** (`src/polyfill.ts`), imported first by the entry, installing the well-known symbol when the runtime lacks it.
- `metadataOf(target)` — a tiny, typed accessor that reads the Stage-3 `Symbol.metadata` record off a decorated class/prototype and returns a `DecoratorMetadata` object (never `undefined`; returns an
  empty frozen record when absent). This is the one primitive every later decorator builds on, and it proves the baseline round-trips through the build.

## Acceptance (this issue)

- `@zmdb/web` resolves in dev (vitest/tsc) via `src` and builds to `dist/index.js` + `dist/index.d.ts`; every declared subpath imports and typechecks from an installed tarball (`yarn verify:publish`).
- A trivial Stage-3 class decorator that writes to `context.metadata` can be read back via `metadataOf(...)` at runtime — **without** `reflect-metadata` and **without** any `as` on the consumer
  surface.
- `zmdb/web` re-export path is present and re-exports the package root.
- Full monorepo suite + typecheck stay green.

## Out of scope (future issues/epics)

Routing (#252), typed `Ctx`/path-params (#257), DI (#262), domain state machines (#267), request pipeline/adapters (#272), data-layer integration (#277), and all NestJS-parity follow-ups (#282–#321).
Those freeze their own SPECs.

## HTTP-only package boundary (#649)

This section supersedes the historical package-ownership statements above and describes the current manifest.

`@zmdb/web` becomes the HTTP adapter over `@zmdb/app`. It owns controllers, routes and versions, typed HTTP context, request/response adapters, guards/pipes/interceptors/filters, body and wire
conversion, static files, compression, uploads, CSRF, OpenAPI, WS/SSE gateways, HTTP health responses, HTTP testing utilities and the HTTP-aware graph inspector.

It does not own metadata/DI/modules/lifecycle, command applications, events, CQRS, state machines, transport-neutral messaging, queues, schedules, external transports, PostgreSQL jobs, OpenTelemetry,
or benchmark helpers.

### Target dependencies and entries

Direct runtime dependencies are exactly the following workspace packages:

```text
@zmdb/app
@zmdb/schema-core
```

The package declares no third-party runtime dependency, optional dependency or runtime peer. Its only peers are optional `@zmdb/compiler` and `typescript@>=7`, reached exclusively from the build-time
`./contract/compiler` entry. Optional technology adapters are separately installed packages. `@zmdb/web` must not import `@zmdb/jobs` or any optional integration package.

The target public entries are:

```text
@zmdb/web
@zmdb/web/app
@zmdb/web/compression
@zmdb/web/context
@zmdb/web/csrf
@zmdb/web/data
@zmdb/web/devtools
@zmdb/web/dto-pipes
@zmdb/web/gateways
@zmdb/web/health
@zmdb/web/middleware
@zmdb/web/openapi
@zmdb/web/pipeline
@zmdb/web/routing
@zmdb/web/static
@zmdb/web/testing
@zmdb/web/upload
@zmdb/web/versioning
```

### HTTP application facade

```ts
export interface WebApplicationOptions extends ApplicationOptions {
  readonly guardRegistry?: GuardRegistry;
  readonly versioning?: VersionStrategy;
}

export interface WebApplication extends Application {
  handle(request: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
}

export function createApp(rootModule: ModuleClass, options?: WebApplicationOptions): WebApplication;
```

`createApp` compiles exactly one application graph through `createApplication`, builds exactly one router from that graph's eager and deferred controller declarations, and delegates lifecycle to the
same `Application`. It does not add a second container, construction ledger, extension loop or lifecycle state machine. The returned `container`, `lazy`, `init` and async-dispose members are the
application members by identity.

`App` is renamed to `WebApplication`. The old `App` and `AppOptions` names are deleted rather than aliased. `createApp` remains the HTTP name; `createApplication` is never reimplemented here.

### Current export ownership oracle

At commit `e66621a5`, the package manifest has 36 entries. The TypeScript checker reports 222 root exports, 543 `(entry, name)` bindings and 318 distinct exported symbols: 108 value-only, 201
type-only and 9 value-and-type symbols. The source tree has 134 TypeScript files, of which 58 are shipped non-test/non-generated source files under the repository's escape-hatch definition.

The following five lists partition all 318 names exactly once. They are intentionally machine-readable: the #645 review oracle parses the markers and fails on a missing, duplicate, extra or
misassigned name.

#### Application kernel — 105

<!-- #645-ownership:app -->

```text
AppOptions
Attributes
Brand
CheckResult
ClientPatterns
Command
CommandApp
CommandBus
CommandBusOptions
CommandClass
CommandDef
CommandHandlers
CommandMap
CommandOutcome
CommandRun
CommentKey
CommentKeys
CommentPairs
CompiledModule
compileModule
Constructor
consumerSpan
Container
createCommandApp
createCommandBus
createEventPublisher
createEvents
createMessageClient
createMessageDispatcher
createToken
databaseReadinessCheck
DatabaseReadinessOptions
defineState
DetailedCheck
DispatcherOptions
DispatchOutcome
EmitReport
EventFailure
EventMap
EventPattern
EventPatterns
EventPublisher
Events
EventsOptions
ExecutingDriver
fromTraceContext
fromTraceparent
getEventHandlers
getMessagePatterns
HealthChecks
Inject
injectionsOf
lazy
LazyImport
LazyModuleHandle
LazyStatus
LivenessCheck
MessageClient
MessageClientOptions
MessageContext
MessageCorrelationError
MessageDispatcher
MessagePattern
MessageRemoteError
MessageReply
MessageTimeoutError
metadataOf
Meter
Module
ModuleClass
ModuleDef
moduleDefOf
Observability
OnApplicationBootstrap
OnEvent
OnModuleInit
OnShutdown
ProviderDef
QueryTelemetry
RawMessage
ReadinessCheck
repositoryToken
ResolvedEventHandler
ResolvedMessagePattern
Scope
Settlement
Span
SpanContext
SpanKind
SpanOptions
State
Token
toTraceHeaders
toTraceparent
TraceCarrier
tracedDriver
Tracer
transition
TransportCapabilities
TransportRequest
TransportStrategy
TransportUnsupportedError
UnresolvedTokenError
WebMetadata
WithHeaders
```

<!-- #645-ownership:end -->

#### HTTP web — 124

<!-- #645-ownership:web -->

```text
AdapterOptions
AnyCtx
App
AuthorizationCodeFlow
bodyText
bytes
Chain
ChainError
ChainHandler
ClassNode
ClientCredentialsFlow
CompiledPattern
compilePattern
compress
compressionInterceptor
CompressionOptions
ContentCoding
Controller
countSegments
createApp
createCsrf
createGatewayDispatcher
createRouter
createStaticHandler
createTestApp
createTracedRouter
Csrf
CsrfOptions
Ctx
decodePipe
Delete
dependentsOf
describeGraph
DetailedBody
detailedReadyRoute
dtoChain
DtoChainOptions
ExceptionFilter
extractParams
file
FileResponseOptions
Finding
FindingKind
Gateway
GatewayDispatcher
Get
getRoutes
getSubscriptions
GraphDescription
GraphFilter
Guard
GuardRegistry
HandlerFor
HealthProbes
healthRoutes
HttpMethod
ImplicitFlow
Interceptor
isPublic
json
JsonSchema
matchCompiled
MessageCtx
ModuleNode
Multipart
multipartPipe
OAuthFlow
OAuthFlows
OpenApiDocument
OpenApiRenderOptions
parseMultipart
PasswordFlow
Patch
PathParams
Pipe
Post
ProviderNode
Public
Put
QueryValues
renderDot
renderTree
ResolvedRoute
respond
ResponseBody
ResponseOptions
RouteDefinition
RouteNode
RouteOptions
Router
RouterOptions
runChain
SecurityAwareGuard
SecurityRequirement
SecurityScheme
serializationInterceptor
serveOpenApi
SseFrame
sseStream
StaticHandler
StaticOptions
stream
StreamOptions
Subscribe
Subscription
TestApp
TestAppOptions
text
toFetchHandler
toNodeHandler
toOpenApi
UPLOAD_DEFAULTS
UploadLimits
UploadPart
validateWith
validationPipe
Version
VersionNeutral
versionsOf
VersionStrategy
WebRequest
WebResponse
wireDecoder
wireEncoder
```

<!-- #645-ownership:end -->

#### Jobs — 34

<!-- #645-ownership:jobs -->

```text
AnyJobHandler
Backoff
Clock
createMemoryJobStore
createQueue
createScheduler
createWorker
Cron
DeadJob
DeadReason
EnqueueOptions
Interval
IntervalOptions
JobContext
JobDialect
JobHandler
JobOutcome
JobStore
LeaseStore
MemoryJobStore
Queue
QueueOptions
RetryPolicy
RunReport
ScheduleDef
Scheduler
SchedulerOptions
schedulesOf
SkippedRun
TaskDecorator
TaskOptions
TaskRuns
Worker
WorkerOptions
```

<!-- #645-ownership:end -->

#### Optional integration packages — 41

<!-- #645-ownership:optional -->

```text
bindGrpcService
createGrpcClient
createNatsStrategy
createPgJobStore
createRabbitMqStrategy
createRedisStrategy
fromOpenTelemetry
GrpcBinding
GrpcCall
GrpcCaller
GrpcClient
GrpcClientCallOptions
GrpcClientOptions
GrpcClientTlsOptions
grpcDescriptor
GrpcError
GrpcFailure
GrpcHandler
GrpcHandlers
GrpcKeyCertPair
GrpcLoadedMethod
GrpcLoadedService
GrpcMetadata
GrpcMetadataValidator
GrpcMethodDef
GrpcServerOptions
GrpcServerTlsOptions
GrpcServiceDef
GrpcServiceSpec
GrpcStatus
GrpcTlsOptions
loadGrpcService
NatsStrategyOptions
NatsSubscription
OpenTelemetryOptions
PgJobClient
PgJobStoreOptions
RabbitMqDeadLetterOptions
RabbitMqRetryOptions
RabbitMqStrategyOptions
RedisStrategyOptions
```

<!-- #645-ownership:end -->

The six generated-service names (`grpcDescriptor`, `loadGrpcService`, `GrpcLoadedMethod`, `GrpcLoadedService`, `GrpcMethodDef`, `GrpcServiceDef`) target `@zmdb/protobuf`. The remaining gRPC names
target `@zmdb/transport-grpc`; NATS now ships from `@zmdb/transport-nats`, while RabbitMQ, Redis and PostgreSQL jobs retain their frozen package targets. OpenTelemetry ships from `@zmdb/otel`. Exact
adapter peer contracts remain owned by #654.

#### Private benchmark helpers — 11

<!-- #645-ownership:private -->

```text
benchmarkAppStartup
benchmarkObservability
BenchmarkOptions
BenchmarkResult
benchmarkRouter
countMetadataReads
MetadataReadCounter
ObservabilityBenchmarkMode
ObservabilityBenchmarkOptions
ObservabilityBenchmarkResult
ObservabilityBenchmarkWorkload
```

<!-- #645-ownership:end -->

`@zmdb/web/bench` is removed from the published manifest. The helpers remain repository-internal benchmark/test support; removing their public export does not remove the measurements.

### Mixed-file split rules

The current source layout does not define ownership. These mixed files must be split rather than forcing a reverse edge:

- `data`: `repositoryToken` moves to app; validation and wire conversion remain web.
- `health`: check contracts, detailed check results and database readiness move to app; `WebResponse` shapes and route factories remain web.
- `observability`: ports, propagation, message spans and driver instrumentation move to app; `createTracedRouter` remains web; the OpenTelemetry adapter becomes `@zmdb/otel`.
- `app`: protocol-neutral lifecycle becomes `createApplication`; HTTP router composition remains `createApp`; gRPC/broker startup becomes application extensions.
- `devtools`: remains web because its route nodes and shadowing findings are HTTP-aware, but consumes app's public module/DI readers and creates no reverse dependency.

### Migration and no-forwarder rule

Moved old subpaths are deleted from `@zmdb/web` in the same changes that add their new owners. No source forwarding module, deprecated export alias, tombstone package or runtime warning remains.
Consumers migrate by changing import specifiers. Runtime values reached through the default `zmdb/app` and `zmdb/web` facades are direct re-exports and preserve `===` identity. Issue #753 removes the
planned runtime `zmdb/jobs` facade: selected jobs values are imported directly from `@zmdb/jobs`, and storage values come from the selected provider.

### Evidence

Implementation must prove:

- the exact acyclic package DAG, the empty third-party peer sets for app/web/portable jobs, and absence of jobs from the default `zmdb` graph;
- every old path is absent and every new path imports from packed tarballs outside the workspace;
- `createApp` uses the same application/container/lifecycle identities as `createApplication`;
- route handling performs no extension walk or package-boundary wrapper per request;
- the existing framework contract and same-machine benchmark are rerun with raw before/after samples, and the implementation does not close with an unexplained median regression above 5%.
