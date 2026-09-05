import type { ApplicationExtension } from '@zmdb/app';
import type { WithHeaders } from '@zmdb/app/messaging';
import type { GrpcLoadedService, GrpcMethodDef, GrpcServiceDef } from '@zmdb/protobuf';
import type { Equal, Expect, ExpectNot, Extends } from '@zmdb/schema-core';

import type {
  GrpcBinding,
  GrpcCall,
  GrpcCaller,
  GrpcClient,
  GrpcClientCallOptions,
  GrpcClientOptions,
  GrpcError,
  GrpcFailure,
  GrpcHandler,
  GrpcHandlers,
  GrpcMetadata,
  GrpcServerOptions,
  GrpcServiceSpec,
  GrpcStatus,
  bindGrpcService,
  createGrpcClient,
  grpcExtension,
} from './index.js';

interface GetOrder {
  readonly id: string;
}

interface Order {
  readonly id: string;
  readonly total: number;
}

interface Chunk {
  readonly text: string;
}

interface UploadAck {
  readonly received: number;
}

type GetDef = { readonly request: GetOrder; readonly response: Order };
type UploadDef = {
  readonly request: Chunk;
  readonly response: UploadAck;
  readonly requestStream: true;
};
type WatchDef = {
  readonly request: GetOrder;
  readonly response: Order;
  readonly responseStream: true;
};
type ChatDef = {
  readonly request: Chunk;
  readonly response: Chunk;
  readonly requestStream: true;
  readonly responseStream: true;
};

type Orders = {
  readonly get: GetDef;
  readonly upload: UploadDef;
  readonly watch: WatchDef;
  readonly chat: ChatDef;
};

interface FrozenGrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

type FrozenGrpcServiceDef = { readonly [method: string]: FrozenGrpcMethodDef };

interface FrozenGrpcCall<T> {
  readonly kind: 'grpc';
  readonly service: string;
  readonly method: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly binaryHeaders: Readonly<Record<string, Uint8Array>>;
  readonly peer: string;
  readonly signal: AbortSignal;
  remainingMs(): number;
  setTrailer(key: string, value: string): void;
}

type UnaryHandler = (call: GrpcCall<GetOrder>) => Promise<Order>;
type ClientStreamHandler = (call: GrpcCall<AsyncIterable<Chunk>>) => Promise<UploadAck>;
type ServerStreamHandler = (call: GrpcCall<GetOrder>) => AsyncIterable<Order>;
type BidiHandler = (call: GrpcCall<AsyncIterable<Chunk>>) => AsyncIterable<Chunk>;

type FrozenStatus =
  | 'OK'
  | 'CANCELLED'
  | 'INVALID_ARGUMENT'
  | 'DEADLINE_EXCEEDED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'FAILED_PRECONDITION'
  | 'UNIMPLEMENTED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'UNAUTHENTICATED';

export type MethodDefShape = Expect<Equal<GrpcMethodDef, FrozenGrpcMethodDef>>;
export type ServiceDefShape = Expect<Equal<GrpcServiceDef, FrozenGrpcServiceDef>>;
export type CallShape = Expect<Equal<GrpcCall<number>, FrozenGrpcCall<number>>>;
export type CallSatisfiesWithHeaders = Expect<Extends<GrpcCall<number>, WithHeaders>>;
export type BinaryMetadataUsesBytes = Expect<
  Equal<GrpcCall<number>['binaryHeaders'], Readonly<Record<string, Uint8Array>>>
>;

export type UnaryHandlerShape = Expect<Equal<GrpcHandler<GetDef>, UnaryHandler>>;
export type ClientStreamHandlerShape = Expect<Equal<GrpcHandler<UploadDef>, ClientStreamHandler>>;
export type ServerStreamHandlerShape = Expect<Equal<GrpcHandler<WatchDef>, ServerStreamHandler>>;
export type BidiHandlerShape = Expect<Equal<GrpcHandler<ChatDef>, BidiHandler>>;

type PartialHandlers = {
  readonly get: UnaryHandler;
  readonly upload: ClientStreamHandler;
  readonly watch: ServerStreamHandler;
};
type CompleteHandlers = PartialHandlers & { readonly chat: BidiHandler };

export type MissingMethodIsRejected = ExpectNot<Extends<PartialHandlers, GrpcHandlers<Orders>>>;
export type CompleteMapIsAccepted = Expect<Extends<CompleteHandlers, GrpcHandlers<Orders>>>;
export type UnaryWhereStreamDeclaredIsRejected = ExpectNot<Extends<UnaryHandler, GrpcHandler<WatchDef>>>;
export type StreamWhereUnaryDeclaredIsRejected = ExpectNot<Extends<ServerStreamHandler, GrpcHandler<GetDef>>>;
export type WrongRequestTypeIsRejected = ExpectNot<
  Extends<(call: GrpcCall<Chunk>) => Promise<Order>, GrpcHandler<GetDef>>
>;

interface OrdersInterface {
  readonly get: GetDef;
  readonly upload: UploadDef;
  readonly watch: WatchDef;
  readonly chat: ChatDef;
}

// @ts-expect-error - concrete service maps must be type aliases, not interfaces.
export type InterfaceServiceIsRejected = GrpcHandlers<OrdersInterface>;

export type StatusShape = Expect<Equal<GrpcStatus, FrozenStatus>>;
export type FailureShape = Expect<
  Equal<
    GrpcFailure,
    {
      readonly service: string;
      readonly method: string;
      readonly status: GrpcStatus;
      readonly error: unknown;
    }
  >
>;
export type ErrorCarriesSafeFields = Expect<
  Extends<GrpcError, { readonly status: GrpcStatus; readonly details: string }>
>;
export type BindingShape = Expect<
  Equal<GrpcBinding, { readonly service: string; readonly methods: readonly string[] }>
>;

interface FrozenServiceSpec {
  readonly definition: GrpcLoadedService<Orders>;
  readonly validateMetadata: (metadata: GrpcMetadata) => GrpcMetadata;
  readonly onError: (failure: GrpcFailure) => void;
  readonly maxDurationMs?: number;
}

export type ServiceSpecShape = Expect<Equal<GrpcServiceSpec<Orders>, FrozenServiceSpec>>;
export type ServiceSpecCarriesItsService = ExpectNot<
  Equal<GrpcServiceSpec<Orders>, GrpcServiceSpec<{ readonly ping: GetDef }>>
>;
export type CredentialsAreRequired = ExpectNot<Extends<undefined, GrpcServerOptions['credentials']>>;
export type ClientDeadlineIsRequired = Expect<Equal<GrpcClientOptions<Orders>['deadlineMs'], number>>;
export type ClientCredentialsAreRequired = ExpectNot<Extends<undefined, GrpcClientOptions<Orders>['credentials']>>;

type FrozenBind = <S extends GrpcServiceDef>(service: GrpcServiceSpec<S>, handlers: GrpcHandlers<S>) => GrpcBinding;

type FrozenCreateClient = <S extends GrpcServiceDef>(options: GrpcClientOptions<S>) => GrpcClient<S>;

export type BindSignature = Expect<Equal<typeof bindGrpcService, FrozenBind>>;
export type ClientSignature = Expect<Equal<typeof createGrpcClient, FrozenCreateClient>>;
export type ExtensionSignature = Expect<
  Equal<typeof grpcExtension, (options: GrpcServerOptions) => ApplicationExtension>
>;

type UnaryCaller = (payload: GetOrder, options?: GrpcClientCallOptions) => Promise<Order>;
type ClientStreamCaller = (payload: AsyncIterable<Chunk>, options?: GrpcClientCallOptions) => Promise<UploadAck>;
type ServerStreamCaller = (payload: GetOrder, options?: GrpcClientCallOptions) => AsyncIterable<Order>;
type BidiCaller = (payload: AsyncIterable<Chunk>, options?: GrpcClientCallOptions) => AsyncIterable<Chunk>;

export type UnaryCallerShape = Expect<Equal<GrpcCaller<GetDef>, UnaryCaller>>;
export type ClientStreamCallerShape = Expect<Equal<GrpcCaller<UploadDef>, ClientStreamCaller>>;
export type ServerStreamCallerShape = Expect<Equal<GrpcCaller<WatchDef>, ServerStreamCaller>>;
export type BidiCallerShape = Expect<Equal<GrpcCaller<ChatDef>, BidiCaller>>;

declare const client: GrpcClient<Orders>;
declare const chunks: AsyncIterable<Chunk>;

client.get({ id: 'o1' });
client.upload(chunks);
client.watch({ id: 'o1' });
client.chat(chunks);
client.close();
client[Symbol.dispose]();

// @ts-expect-error - unary request payloads are checked.
client.get({ text: 'wrong' });
// @ts-expect-error - client-streaming methods require an async iterable.
client.upload({ text: 'wrong' });
// @ts-expect-error - server-streaming methods require one request, not a stream.
client.watch(chunks);
// @ts-expect-error - bidirectional methods require an async iterable.
client.chat({ text: 'wrong' });
