// @zmdb/web — Stage-3 decorator web framework for the zmdb ecosystem.
//
// This is the package baseline (epic #247, spec packages/web/SPEC.md): the one
// primitive every later decorator builds on. Routing, typed Ctx, DI, domain
// state machines, the request pipeline and the NestJS-parity layers arrive in
// their own sub-modules under later issues.
//
// Invariants: no reflect-metadata, no runtime reflection, Stage 3 decorators
// only (`experimentalDecorators: false`), and no `as`/`any`/`!` on the consumer
// surface. See ARCHITECTURE.md §2.

// Install the well-known Symbol.metadata if the runtime lacks it (Node 26 does).
// Must run before any decorated class is evaluated — hence the side-effecting
// import at the top of the package entry.
import './polyfill.js';

// The Stage-3 metadata record type. `Symbol.metadata` is a well-known symbol
// present on Node 26; `DecoratorMetadata`/`DecoratorMetadataObject` come from
// the standard `lib`. We model a metadata record as an index of unknown values
// — consumers narrow their own slots, and the framework's typed accessors
// (added by later issues) expose strongly-typed views without assertions.
export type WebMetadata = DecoratorMetadataObject;

// A carrier that *may* have a Stage-3 metadata record attached. Decorated
// classes get one via the runtime; `null` when the class was never decorated.
interface HasMetadata {
  readonly [Symbol.metadata]?: DecoratorMetadata | null;
}

const EMPTY: WebMetadata = Object.freeze(Object.create(null));

// Type guard proving a value carries a non-null metadata record. This is the
// single trust boundary for reading the well-known symbol; it uses a runtime
// check (not an assertion) so no `as` is needed.
function hasMetadata(value: object): value is { readonly [Symbol.metadata]: DecoratorMetadata } {
  const carrier: HasMetadata = value;
  const record = carrier[Symbol.metadata];
  return record !== undefined && record !== null;
}

/**
 * Read the Stage-3 `Symbol.metadata` record off a decorated class (or any
 * object carrying one). Never returns `undefined`: an undecorated target yields
 * a shared, frozen empty record so callers can read slots unconditionally.
 *
 * No `reflect-metadata`, no `as` — the well-known symbol is read behind a type
 * guard.
 */
export function metadataOf(target: object): WebMetadata {
  return hasMetadata(target) ? target[Symbol.metadata] : EMPTY;
}

// Controllers & routing (Stage-3 decorators → context.metadata). See ./routing.
export {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Public,
  getRoutes,
  isPublic,
  type HttpMethod,
  type RouteDefinition,
  type ResolvedRoute,
} from './routing/index.js';

// API version declarations and strategy types. See ./versioning.
export { Version, VersionNeutral, versionsOf, type VersionStrategy } from './versioning/index.js';

// Typed request context + compile-time path-param derivation. See ./context.
export {
  extractParams,
  compilePattern,
  countSegments,
  matchCompiled,
  type CompiledPattern,
  type PathParams,
  type QueryValues,
  type Ctx,
  type HandlerFor,
} from './context/index.js';

// Compile-time dependency injection: Container + @Inject. See ./di.
export {
  Container,
  createToken,
  Inject,
  injectionsOf,
  UnresolvedTokenError,
  type Token,
  type Constructor,
  type Scope,
} from './di/index.js';

// Compile-time domain state machines (branded/phantom types). See ./state.
export { defineState, transition, type Brand, type State } from './state/index.js';

// Request pipeline & runtime adapters. See ./pipeline.
export {
  createRouter,
  toNodeHandler,
  toFetchHandler,
  json,
  text,
  respond,
  bytes,
  stream,
  file,
  bodyText,
  type Router,
  type WebRequest,
  type WebResponse,
  type ResponseBody,
  type RouteOptions,
  type GuardRegistry,
  type RouterOptions,
  type ResponseOptions,
  type StreamOptions,
  type FileResponseOptions,
  type AdapterOptions,
} from './pipeline/index.js';

// Confined static files with validators and single-range streaming. See ./static.
export { createStaticHandler, type StaticHandler, type StaticOptions } from './static/index.js';

// Incremental, cross-runtime gzip/deflate middleware. See ./compression.
export { compress, compressionInterceptor, type CompressionOptions, type ContentCoding } from './compression/index.js';

// Narrow telemetry ports, propagation and driver instrumentation. See ./observability.
export {
  SpanKind,
  createTracedRouter,
  tracedDriver,
  consumerSpan,
  fromTraceContext,
  fromTraceparent,
  toTraceHeaders,
  toTraceparent,
  type Attributes,
  type CommentKey,
  type CommentKeys,
  type CommentPairs,
  type ExecutingDriver,
  type Meter,
  type Observability,
  type QueryTelemetry,
  type Span,
  type SpanContext,
  type SpanOptions,
  type TraceCarrier,
  type Tracer,
} from './observability/index.js';

// zmdb data-layer integration: repository DI token + validateBody adapter. See ./data.
export { repositoryToken, validateWith } from './data/index.js';

// Modules & providers over the DI Container. See ./modules.
export {
  Module,
  compileModule,
  lazy,
  moduleDefOf,
  type ModuleDef,
  type ModuleClass,
  type ProviderDef,
  type CompiledModule,
  type LazyImport,
  type LazyModuleHandle,
  type LazyStatus,
} from './modules/index.js';

// Guards, pipes, interceptors & exception filters. See ./middleware.
export {
  runChain,
  ChainError,
  type AnyCtx,
  type Guard,
  type SecurityAwareGuard,
  type Pipe,
  type Interceptor,
  type ExceptionFilter,
  type Chain,
  type ChainHandler,
} from './middleware/index.js';

// Transport-neutral message dispatch and typed clients. See ./microservices.
export {
  EventPattern,
  MessagePattern,
  MessageCorrelationError,
  MessageRemoteError,
  MessageTimeoutError,
  TransportUnsupportedError,
  createEventPublisher,
  createMessageClient,
  createMessageDispatcher,
  getMessagePatterns,
  type AppOptions,
  type ClientPatterns,
  type DispatchOutcome,
  type DispatcherOptions,
  type EventPatterns,
  type EventPublisher,
  type MessageClient,
  type MessageClientOptions,
  type MessageContext,
  type MessageDispatcher,
  type MessageReply,
  type RawMessage,
  type ResolvedMessagePattern,
  type Settlement,
  type TransportCapabilities,
  type TransportRequest,
  type TransportStrategy,
  type WithHeaders,
} from './microservices/index.js';

// Application bootstrap & lifecycle. See ./app.
export { createApp, type App, type OnModuleInit, type OnApplicationBootstrap, type OnShutdown } from './app/index.js';

// DTO validation & serialization pipes. See ./dto-pipes.
export {
  validationPipe,
  multipartPipe,
  serializationInterceptor,
  dtoChain,
  type DtoChainOptions,
} from './dto-pipes/index.js';

// Bounded multipart/form-data parsing. See ./upload.
export { parseMultipart, UPLOAD_DEFAULTS, type Multipart, type UploadLimits, type UploadPart } from './upload/index.js';

// Stateless, session-bound CSRF protection. See ./csrf.
export { createCsrf, type Csrf, type CsrfOptions } from './csrf/index.js';

// OpenAPI 3.1 generation from routes + schemas. See ./openapi.
export {
  toOpenApi,
  serveOpenApi,
  type OpenApiDocument,
  type OpenApiOptions,
  type RouteSchemas,
  type VersionSchemas,
  type JsonSchema,
  type OAuthFlows,
  type SecurityRequirement,
  type SecurityScheme,
} from './openapi/index.js';

// WebSocket & SSE gateways. See ./gateways.
export {
  Gateway,
  Subscribe,
  getSubscriptions,
  createGatewayDispatcher,
  sseStream,
  type MessageCtx,
  type Subscription,
  type GatewayDispatcher,
  type SseFrame,
} from './gateways/index.js';

// SQL-backed job workers with typed handlers, retries and bounded drain. See ./queues.
export {
  createQueue,
  createWorker,
  type AnyJobHandler,
  type Backoff,
  type Clock,
  type DeadJob,
  type DeadReason,
  type EnqueueOptions,
  type JobContext,
  type JobDialect,
  type JobHandler,
  type JobOutcome,
  type JobStore,
  type Queue,
  type QueueOptions,
  type RetryPolicy,
  type RunReport,
  type Worker,
  type WorkerOptions,
} from './queues/index.js';

// App-owned cron and interval scheduling with explicit scale-out semantics. See ./schedule.
export {
  Cron,
  Interval,
  createScheduler,
  schedulesOf,
  type IntervalOptions,
  type LeaseStore,
  type ScheduleDef,
  type Scheduler,
  type SchedulerOptions,
  type SkippedRun,
  type TaskDecorator,
  type TaskOptions,
  type TaskRuns,
} from './schedule/index.js';

// Testing utilities: in-process app + provider overrides. See ./testing.
export { createTestApp, type TestApp, type TestAppOptions } from './testing/index.js';

// Router benchmark & perf verification. See ./bench.
export {
  benchmarkAppStartup,
  benchmarkObservability,
  benchmarkRouter,
  countMetadataReads,
  type BenchmarkOptions,
  type BenchmarkResult,
  type MetadataReadCounter,
  type ObservabilityBenchmarkMode,
  type ObservabilityBenchmarkOptions,
  type ObservabilityBenchmarkResult,
  type ObservabilityBenchmarkWorkload,
} from './bench/index.js';
