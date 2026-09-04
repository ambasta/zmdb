import type { GrpcLoadedService, GrpcMethodDef, GrpcServiceDef } from '@zmdb/aot-validator';

/** Text and binary gRPC metadata are kept in separate maps. */
export interface GrpcMetadata {
  readonly headers: Readonly<Record<string, string>>;
  readonly binaryHeaders: Readonly<Record<string, Uint8Array>>;
}

/** Required validation boundary for metadata exposed to application code. */
export type GrpcMetadataValidator = (metadata: GrpcMetadata) => GrpcMetadata;

/** The application-facing context for one gRPC handler invocation. */
export interface GrpcCall<T> {
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

/** Handler shape selected from the request/response streaming flags. */
export type GrpcHandler<D extends GrpcMethodDef> = D extends { requestStream: true }
  ? D extends { responseStream: true }
    ? (call: GrpcCall<AsyncIterable<D['request']>>) => AsyncIterable<D['response']>
    : (call: GrpcCall<AsyncIterable<D['request']>>) => Promise<D['response']>
  : D extends { responseStream: true }
    ? (call: GrpcCall<D['request']>) => AsyncIterable<D['response']>
    : (call: GrpcCall<D['request']>) => Promise<D['response']>;

/** A total handler map: every declared service method must be implemented. */
export type GrpcHandlers<S extends GrpcServiceDef> = {
  readonly [M in keyof S]: GrpcHandler<S[M]>;
};

export type GrpcStatus =
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

/** A deliberately safe error that may cross the gRPC boundary. */
export class GrpcError extends Error {
  readonly status: GrpcStatus;
  readonly details: string;

  constructor(status: GrpcStatus, details: string) {
    super(details);
    this.name = 'GrpcError';
    this.status = status;
    this.details = details;
  }
}

/** The private failure sent to the required observation sink. */
export interface GrpcFailure {
  readonly service: string;
  readonly method: string;
  readonly status: GrpcStatus;
  readonly error: unknown;
}

/** A server identity certificate and private key. */
export interface GrpcKeyCertPair {
  readonly privateKey: Uint8Array;
  readonly certificateChain: Uint8Array;
}

/** TLS material accepted by a gRPC server. */
export interface GrpcServerTlsOptions {
  readonly rootCertificates?: Uint8Array;
  readonly keyCertPairs: readonly GrpcKeyCertPair[];
  readonly checkClientCertificate: boolean;
}

/** TLS material accepted by a gRPC client. */
export interface GrpcClientTlsOptions {
  readonly rootCertificates?: Uint8Array;
  readonly privateKey?: Uint8Array;
  readonly certificateChain?: Uint8Array;
}

/** Compatibility name for code that shares a credentials helper. */
export type GrpcTlsOptions = GrpcServerTlsOptions | GrpcClientTlsOptions;

/**
 * One bound service. Runtime state is owned by the binding object; the public
 * surface exposes only its declared identity.
 */
export interface GrpcBinding {
  readonly service: string;
  readonly methods: readonly string[];
}

/**
 * A typed build artifact plus the two runtime policies that cannot be inferred
 * from a TypeScript declaration.
 */
export interface GrpcServiceSpec<S extends GrpcServiceDef> {
  readonly definition: GrpcLoadedService<S>;
  readonly validateMetadata: GrpcMetadataValidator;
  readonly onError: (failure: GrpcFailure) => void;
  readonly maxDurationMs?: number;
}

export interface GrpcServerOptions {
  readonly address: string;
  readonly bindings: readonly GrpcBinding[];
  readonly credentials: 'insecure' | GrpcServerTlsOptions;
}

/** Per-call metadata, cancellation and deadline propagation. */
export interface GrpcClientCallOptions {
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
  readonly metadata?: GrpcMetadata;
  readonly onMetadata?: (metadata: GrpcMetadata) => void;
  readonly onTrailer?: (metadata: GrpcMetadata) => void;
}

/** Typed caller selected from the same four stream flags as the handler. */
export type GrpcCaller<D extends GrpcMethodDef> = D extends { requestStream: true }
  ? D extends { responseStream: true }
    ? (payload: AsyncIterable<D['request']>, options?: GrpcClientCallOptions) => AsyncIterable<D['response']>
    : (payload: AsyncIterable<D['request']>, options?: GrpcClientCallOptions) => Promise<D['response']>
  : D extends { responseStream: true }
    ? (payload: D['request'], options?: GrpcClientCallOptions) => AsyncIterable<D['response']>
    : (payload: D['request'], options?: GrpcClientCallOptions) => Promise<D['response']>;

/** One typed property per service method, plus explicit channel ownership. */
export type GrpcClient<S extends GrpcServiceDef> = {
  readonly [M in keyof S]: GrpcCaller<S[M]>;
} & {
  close(): void;
  [Symbol.dispose](): void;
};

export interface GrpcClientOptions<S extends GrpcServiceDef> {
  readonly definition: GrpcLoadedService<S>;
  readonly address: string;
  readonly credentials: 'insecure' | GrpcClientTlsOptions;
  readonly deadlineMs: number;
  readonly validateMetadata: GrpcMetadataValidator;
}

export type { GrpcLoadedService, GrpcMethodDef, GrpcServiceDef };
