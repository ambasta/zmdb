// @zmdb/web — the HTTP adapter for the zmdb application kernel.
//
// Stage-3 metadata, DI, modules and lifecycle are installed and owned by
// @zmdb/app. Importing the web root activates that one metadata baseline before
// any HTTP decorator is evaluated.
import '@zmdb/app';

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
  type RouteDefinition,
  type ResolvedRoute,
} from './routing/index.js';

// Inert HTTP declarations and serialisable operation IR. The compiler-backed
// collector is intentionally available only from `@zmdb/web/contract/compiler`.
export {
  defineHttpContract,
  httpOperation,
  type AuthorizationCodeFlow,
  type ClientCredentialsFlow,
  type CompiledHttpContract,
  type CompiledHttpOperation,
  type HttpBodyDeclaration,
  type HttpBodyIR,
  type HttpBodyKind,
  type HttpContractDeclaration,
  type HttpContractIR,
  type HttpController,
  type HttpMethod,
  type HttpOperationDeclaration,
  type HttpOperationIR,
  type HttpOperationTypes,
  type HttpParameterDeclaration,
  type HttpParameterIR,
  type HttpRequestBodyDeclaration,
  type HttpRequestBodyIR,
  type HttpResponseDeclaration,
  type HttpResponseHeaderDeclaration,
  type HttpResponseHeaderIR,
  type HttpResponseIR,
  type HttpTypeIR,
  type HttpVersionDeclaration,
  type HttpVersionIR,
  type ImplicitFlow,
  type JsonValue,
  type OAuthFlow,
  type OAuthFlows,
  type PasswordFlow,
  type SecurityRequirement,
  type SecurityScheme,
} from './contract/index.js';

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

// HTTP router construction over app-owned observability ports.
export { createTracedRouter } from './traced-router.js';

// HTTP validation and wire conversion. Repository DI tokens are app-owned.
export { validateWith } from './data/index.js';

// Guards, pipes, interceptors & exception filters. See ./middleware.
export {
  runChain,
  compileRouteChain,
  UseGuards,
  UsePipes,
  UseInterceptors,
  UseFilters,
  ChainError,
  type AnyCtx,
  type Guard,
  type SecurityAwareGuard,
  type Pipe,
  type Interceptor,
  type ExceptionFilter,
  type Chain,
  type ChainHandler,
  type GuardInput,
  type PipeInput,
  type InterceptorInput,
  type FilterInput,
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

// HTTP application bootstrap over one app-owned graph. See ./app.
export { createApp, type App, type WebApplication, type WebApplicationOptions } from './app/index.js';

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

// OpenAPI 3.1 projection from the shared HTTP contract IR. See ./openapi.
export {
  toOpenApi,
  serveOpenApi,
  type JsonSchema,
  type OpenApiDocument,
  type OpenApiRenderOptions,
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
