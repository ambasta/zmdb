import {
  Client,
  Metadata,
  Server,
  ServerCredentials,
  credentials,
  status,
  type ClientDuplexStream,
  type ClientReadableStream,
  type ClientUnaryCall,
  type ClientWritableStream,
  type MethodDefinition,
  type ServerDuplexStream,
  type ServerErrorResponse,
  type ServerReadableStream,
  type ServerUnaryCall,
  type ServerWritableStream,
  type ServiceDefinition,
  type StatusObject,
  type UntypedHandleCall,
  type UntypedServiceImplementation,
  type sendUnaryData,
} from '@grpc/grpc-js';
import type { ApplicationExtension } from '@zmdb/app';
import type { GrpcLoadedMethod, GrpcMethodDef, GrpcServiceDef } from '@zmdb/protobuf';

import {
  GrpcError,
  type GrpcBinding,
  type GrpcCall,
  type GrpcClient,
  type GrpcClientCallOptions,
  type GrpcClientOptions,
  type GrpcClientTlsOptions,
  type GrpcHandlers,
  type GrpcMetadata,
  type GrpcMetadataValidator,
  type GrpcServerOptions,
  type GrpcServerTlsOptions,
  type GrpcServiceSpec,
  type GrpcStatus,
} from './types.js';

export interface OpenedGrpcServer {
  readonly port: number;
  close(graceMs: number): Promise<void>;
}

type RuntimeMethod = GrpcLoadedMethod<GrpcMethodDef>;

type DecodedRequest = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

interface ServerCallSurface {
  readonly cancelled: boolean;
  readonly metadata: Metadata;
  getDeadline(): Date | number;
  getPeer(): string;
  on(event: string, listener: () => void): this;
  removeListener(event: string, listener: () => void): this;
}

interface WritableResponseCall extends ServerCallSurface {
  write(value: unknown): boolean;
  end(metadata?: Metadata): void;
  destroy(error: Error): void;
  once(event: 'drain', listener: () => void): this;
  removeListener(event: 'drain', listener: () => void): this;
}

interface ReadableRequestCall extends ServerCallSurface, AsyncIterable<DecodedRequest> {}

interface CallScope {
  readonly signal: AbortSignal;
  readonly trailers: Readonly<Record<string, string>>;
  remainingMs(): number;
  setTrailer(key: string, value: string): void;
  reason(): GrpcError;
  close(): void;
}

interface ClientSurfaceCall {
  cancel(): void;
  on(event: 'metadata', listener: (metadata: Metadata) => void): this;
  on(event: 'status', listener: (status: StatusObject) => void): this;
}

interface RequestPump {
  readonly done: Promise<void>;
  failure(): { readonly failed: false } | { readonly failed: true; readonly error: unknown };
}

class BoundGrpcService<S extends GrpcServiceDef> implements GrpcBinding {
  readonly service: string;
  readonly methods: readonly string[];
  readonly #spec: GrpcServiceSpec<S>;
  readonly #handlers: GrpcHandlers<S>;

  constructor(spec: GrpcServiceSpec<S>, handlers: GrpcHandlers<S>) {
    this.#spec = spec;
    this.#handlers = handlers;
    this.service = spec.definition.name;
    this.methods = Object.freeze(Object.keys(spec.definition.methods));
  }

  register(server: Server): void {
    const definition: Record<string, MethodDefinition<DecodedRequest, unknown>> = Object.create(null);
    const implementation: UntypedServiceImplementation = Object.create(null);

    for (const [name, method] of methodEntries(this.#spec.definition.methods)) {
      definition[name] = {
        path: method.path,
        requestStream: method.requestStream,
        responseStream: method.responseStream,
        requestSerialize: value => grpcBytes(serializeRequest(method, value)),
        requestDeserialize: bytes => decodeRequest(method, bytes),
        responseSerialize: value => grpcBytes(serializeResponse(method, value)),
        responseDeserialize: bytes => deserializeResponse(method, bytes),
      };
      implementation[name] = serverHandler(name, method, this.#spec, this.#handlers);
    }

    const serviceDefinition: ServiceDefinition = definition;
    server.addService(serviceDefinition, implementation);
  }
}

/** Bind one generated service definition to its exhaustive typed handler map. */
export function bindGrpcService<S extends GrpcServiceDef>(
  service: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): GrpcBinding {
  validateServiceSpec(service);
  return new BoundGrpcService(service, handlers);
}

/** Attach one gRPC server to the protocol-neutral application lifecycle. */
export function grpcExtension(options: GrpcServerOptions): ApplicationExtension {
  let opened: OpenedGrpcServer | undefined;
  return {
    name: '@zmdb/transport-grpc',
    async start() {
      opened = await openGrpcServer(options);
    },
    async stop({ graceMs }) {
      try {
        await opened?.close(graceMs);
      } finally {
        opened = undefined;
      }
    },
  };
}

/** Create a typed client from the same generated service artifact used by the server. */
export function createGrpcClient<S extends GrpcServiceDef>(options: GrpcClientOptions<S>): GrpcClient<S> {
  validatePositiveDuration(options.deadlineMs, 'deadlineMs');
  const channel = new Client(options.address, clientCredentials(options.credentials));
  const client: GrpcClient<S> = Object.create(null);

  for (const [name, method] of methodEntries(options.definition.methods)) {
    if (name === 'close') {
      channel.close();
      throw new Error(
        '@zmdb/transport-grpc: a gRPC method cannot be named "close" because the typed client owns that member',
      );
    }
    Object.defineProperty(client, name, {
      configurable: false,
      enumerable: true,
      value: clientCaller(channel, method, options),
      writable: false,
    });
  }

  const close = (): void => {
    channel.close();
  };
  Object.defineProperties(client, {
    close: { configurable: false, enumerable: false, value: close, writable: false },
    [Symbol.dispose]: { configurable: false, enumerable: false, value: close, writable: false },
  });
  return client;
}

/** Start all bound services. Kept internal to the application lifecycle. */
export async function openGrpcServer(options: GrpcServerOptions): Promise<OpenedGrpcServer> {
  if (options.address.length === 0) {
    throw new RangeError('@zmdb/transport-grpc: a gRPC server address cannot be empty');
  }
  if (options.bindings.length === 0) {
    throw new RangeError('@zmdb/transport-grpc: a gRPC server requires at least one binding');
  }

  const server = new Server();
  try {
    for (const binding of options.bindings) {
      if (!(binding instanceof BoundGrpcService)) {
        throw new TypeError('@zmdb/transport-grpc: gRPC bindings must be created by bindGrpcService');
      }
      binding.register(server);
    }
    const port = await bindServer(server, options.address, serverCredentials(options.credentials));
    let closePromise: Promise<void> | undefined;
    return {
      port,
      close: graceMs => {
        closePromise ??= closeServer(server, graceMs);
        return closePromise;
      },
    };
  } catch (error) {
    server.forceShutdown();
    throw error;
  }
}

function methodEntries(
  methods: Readonly<Record<string, RuntimeMethod>>,
): readonly (readonly [string, RuntimeMethod])[] {
  return Object.entries(methods);
}

function validateServiceSpec<S extends GrpcServiceDef>(service: GrpcServiceSpec<S>): void {
  if (service.definition.name.length === 0) {
    throw new RangeError('@zmdb/transport-grpc: a gRPC service name cannot be empty');
  }
  if (Object.keys(service.definition.methods).length === 0) {
    throw new RangeError(`@zmdb/transport-grpc: gRPC service "${service.definition.name}" has no methods`);
  }
  if (service.maxDurationMs !== undefined) {
    validatePositiveDuration(service.maxDurationMs, 'maxDurationMs');
  }
}

function validatePositiveDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`@zmdb/transport-grpc: ${name} must be a positive finite number`);
  }
}

function grpcBytes(bytes: Uint8Array): ReturnType<typeof globalThis.Buffer.from> {
  return globalThis.Buffer.from(bytes);
}

function decodeRequest(method: RuntimeMethod, bytes: Uint8Array): DecodedRequest {
  try {
    const value = method.deserializeRequest(bytes);
    return { ok: true, value: method.validateRequest(value) };
  } catch (error) {
    return { ok: false, error };
  }
}

function serializeRequest(method: RuntimeMethod, value: unknown): Uint8Array {
  return method.serializeRequest(method.validateRequest(value));
}

function serializeResponse(method: RuntimeMethod, value: unknown): Uint8Array {
  return method.serializeResponse(method.validateResponse(value));
}

function deserializeResponse(method: RuntimeMethod, bytes: Uint8Array): unknown {
  return method.validateResponse(method.deserializeResponse(bytes));
}

function serverHandler<S extends GrpcServiceDef>(
  name: string,
  method: RuntimeMethod,
  spec: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): UntypedHandleCall {
  if (method.requestStream) {
    return method.responseStream
      ? (call: ServerDuplexStream<DecodedRequest, unknown>) => {
          void runBidi(call, name, method, spec, handlers);
        }
      : (call: ServerReadableStream<DecodedRequest, unknown>, callback: sendUnaryData<unknown>) => {
          void runClientStream(call, callback, name, method, spec, handlers);
        };
  }
  return method.responseStream
    ? (call: ServerWritableStream<DecodedRequest, unknown>) => {
        void runServerStream(call, name, method, spec, handlers);
      }
    : (call: ServerUnaryCall<DecodedRequest, unknown>, callback: sendUnaryData<unknown>) => {
        void runUnary(call, callback, name, method, spec, handlers);
      };
}

async function runUnary<S extends GrpcServiceDef>(
  call: ServerUnaryCall<DecodedRequest, unknown>,
  callback: sendUnaryData<unknown>,
  name: string,
  method: RuntimeMethod,
  spec: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): Promise<void> {
  const scope = callScope(call, spec.maxDurationMs);
  try {
    const request = requestValue(call.request);
    const context = grpcCall(call, spec, name, request, scope);
    const handler = handlerAt<(call: GrpcCall<unknown>) => Promise<unknown>>(handlers, name);
    const response = method.validateResponse(await handler(context));
    callback(null, response, trailers(scope.trailers));
  } catch (error) {
    callback(serverError(boundaryError(error, scope, spec, name)));
  } finally {
    scope.close();
  }
}

async function runClientStream<S extends GrpcServiceDef>(
  call: ServerReadableStream<DecodedRequest, unknown>,
  callback: sendUnaryData<unknown>,
  name: string,
  method: RuntimeMethod,
  spec: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): Promise<void> {
  const scope = callScope(call, spec.maxDurationMs);
  try {
    const requests = requestStream(call, scope);
    const context = grpcCall(call, spec, name, requests, scope);
    const handler = handlerAt<(call: GrpcCall<AsyncIterable<unknown>>) => Promise<unknown>>(handlers, name);
    const response = method.validateResponse(await handler(context));
    callback(null, response, trailers(scope.trailers));
  } catch (error) {
    callback(serverError(boundaryError(error, scope, spec, name)));
  } finally {
    scope.close();
  }
}

async function runServerStream<S extends GrpcServiceDef>(
  call: ServerWritableStream<DecodedRequest, unknown>,
  name: string,
  method: RuntimeMethod,
  spec: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): Promise<void> {
  const scope = callScope(call, spec.maxDurationMs);
  try {
    const request = requestValue(call.request);
    const context = grpcCall(call, spec, name, request, scope);
    const handler = handlerAt<(call: GrpcCall<unknown>) => AsyncIterable<unknown>>(handlers, name);
    await writeResponses(call, handler(context), method, scope);
    call.end(trailers(scope.trailers));
  } catch (error) {
    call.destroy(serverError(boundaryError(error, scope, spec, name)));
  } finally {
    scope.close();
  }
}

function enableHalfOpenStream(stream: object): void {
  const readable = Reflect.get(stream, '_readableState');
  if (readable && typeof readable === 'object') {
    Reflect.set(readable, 'allowHalfOpen', true);
    Reflect.set(readable, 'autoDestroy', false);
  }
  const writable = Reflect.get(stream, '_writableState');
  if (writable && typeof writable === 'object') {
    Reflect.set(writable, 'autoDestroy', false);
  }
}

async function runBidi<S extends GrpcServiceDef>(
  call: ServerDuplexStream<DecodedRequest, unknown>,
  name: string,
  method: RuntimeMethod,
  spec: GrpcServiceSpec<S>,
  handlers: GrpcHandlers<S>,
): Promise<void> {
  enableHalfOpenStream(call);
  const scope = callScope(call, spec.maxDurationMs);
  try {
    const requests = requestStream(call, scope);
    const context = grpcCall(call, spec, name, requests, scope);
    const handler = handlerAt<(call: GrpcCall<AsyncIterable<unknown>>) => AsyncIterable<unknown>>(handlers, name);
    await writeResponses(call, handler(context), method, scope);
    call.end(trailers(scope.trailers));
  } catch (error) {
    call.destroy(serverError(boundaryError(error, scope, spec, name)));
  } finally {
    scope.close();
  }
}

function requestValue(decoded: DecodedRequest): unknown {
  if (!decoded.ok) {
    throw new GrpcError('INVALID_ARGUMENT', 'invalid request');
  }
  return decoded.value;
}

async function* requestStream(call: ReadableRequestCall, scope: CallScope): AsyncIterable<unknown> {
  const iterator = call[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await nextRequest(iterator, scope);
      if (next.done) return;
      yield requestValue(next.value);
    }
  } finally {
    await iterator.return?.();
  }
}

async function nextRequest(
  iterator: AsyncIterator<DecodedRequest>,
  scope: CallScope,
): Promise<IteratorResult<DecodedRequest>> {
  if (scope.signal.aborted) throw scope.reason();
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(scope.reason());
    };
    scope.signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => {
      scope.signal.removeEventListener('abort', onAbort);
    };
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    removeAbort();
  }
}

function writeChunk(call: WritableResponseCall, chunk: unknown, scope: CallScope): Promise<void> {
  if (scope.signal.aborted) return Promise.reject(scope.reason());
  if (!call.write(chunk)) {
    return waitForDrain(call, scope);
  }
  return Promise.resolve();
}

async function writeResponses(
  call: WritableResponseCall,
  responses: AsyncIterable<unknown>,
  method: RuntimeMethod,
  scope: CallScope,
): Promise<void> {
  for await (const response of responses) {
    if (scope.signal.aborted) throw scope.reason();
    const valid = method.validateResponse(response);
    await writeChunk(call, valid, scope);
  }
}

function handlerAt<T>(handlers: object, name: string): T {
  return Reflect.get(handlers, name);
}

function waitForDrain(call: WritableResponseCall, scope: CallScope): Promise<void> {
  if (scope.signal.aborted) return Promise.reject(scope.reason());
  return new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      scope.signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      call.removeListener('drain', onDrain);
      reject(scope.reason());
    };
    call.once('drain', onDrain);
    scope.signal.addEventListener('abort', onAbort, { once: true });
  });
}

function grpcCall<T, S extends GrpcServiceDef>(
  call: ServerCallSurface,
  spec: GrpcServiceSpec<S>,
  method: string,
  payload: T,
  scope: CallScope,
): GrpcCall<T> {
  let metadata: GrpcMetadata;
  try {
    metadata = validateMetadata(call.metadata, spec.validateMetadata);
  } catch {
    throw new GrpcError('INVALID_ARGUMENT', 'invalid metadata');
  }
  return {
    kind: 'grpc',
    service: spec.definition.name,
    method,
    payload,
    headers: metadata.headers,
    binaryHeaders: metadata.binaryHeaders,
    peer: call.getPeer(),
    signal: scope.signal,
    remainingMs: () => scope.remainingMs(),
    setTrailer: (key, value) => {
      scope.setTrailer(key, value);
    },
  };
}

function callScope(call: ServerCallSurface, maxDurationMs?: number): CallScope {
  const controller = new AbortController();
  const trailerValues: Record<string, string> = Object.create(null);
  const now = Date.now();
  const callerDeadline = deadlineTime(call.getDeadline());
  const serverDeadline = maxDurationMs === undefined ? Number.POSITIVE_INFINITY : now + maxDurationMs;
  const deadline = Math.min(callerDeadline, serverDeadline);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abort = (reason: GrpcError): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onCancelled = (): void => {
    const expired = Number.isFinite(deadline) && Date.now() >= deadline;
    abort(
      expired ? new GrpcError('DEADLINE_EXCEEDED', 'deadline exceeded') : new GrpcError('CANCELLED', 'call cancelled'),
    );
  };
  const scheduleDeadline = (): void => {
    if (!Number.isFinite(deadline) || controller.signal.aborted) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      abort(new GrpcError('DEADLINE_EXCEEDED', 'deadline exceeded'));
      return;
    }
    timer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
  };

  call.on('cancelled', onCancelled);
  if (call.cancelled) onCancelled();
  scheduleDeadline();

  return {
    signal: controller.signal,
    trailers: trailerValues,
    remainingMs: () => (Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : Number.POSITIVE_INFINITY),
    setTrailer: (key, value) => {
      const probe = new Metadata();
      probe.set(key, value);
      trailerValues[key] = value;
    },
    reason: () =>
      controller.signal.reason instanceof GrpcError
        ? controller.signal.reason
        : new GrpcError('CANCELLED', 'call cancelled'),
    close: () => {
      if (timer !== undefined) clearTimeout(timer);
      call.removeListener('cancelled', onCancelled);
    },
  };
}

function deadlineTime(deadline: Date | number): number {
  return deadline instanceof Date ? deadline.getTime() : deadline;
}

function validateMetadata(metadata: Metadata, validate: GrpcMetadataValidator): GrpcMetadata {
  return validate(metadataValue(metadata));
}

function metadataValue(metadata: Metadata): GrpcMetadata {
  const headers: Record<string, string> = Object.create(null);
  const binaryHeaders: Record<string, Uint8Array> = Object.create(null);
  for (const [key, values] of Object.entries(metadata.toJSON())) {
    const value = values[0];
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (value !== undefined) {
      binaryHeaders[key] = Uint8Array.from(value);
    }
  }
  return { headers, binaryHeaders };
}

function outboundMetadata(metadata?: GrpcMetadata): Metadata {
  const result = new Metadata();
  if (metadata === undefined) return result;
  for (const [key, value] of Object.entries(metadata.headers)) result.set(key, value);
  for (const [key, value] of Object.entries(metadata.binaryHeaders)) result.set(key, grpcBytes(value));
  return result;
}

function trailers(values: Readonly<Record<string, string>>): Metadata {
  const result = new Metadata();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

function boundaryError<S extends GrpcServiceDef>(
  error: unknown,
  scope: CallScope,
  spec: GrpcServiceSpec<S>,
  method: string,
): GrpcError {
  if (error instanceof GrpcError) return error;
  if (scope.signal.aborted) return scope.reason();
  try {
    spec.onError({
      service: spec.definition.name,
      method,
      status: 'INTERNAL',
      error,
    });
  } catch {
    // Observation must not replace the fixed boundary error.
  }
  return new GrpcError('INTERNAL', 'internal error');
}

function serverError(error: GrpcError): ServerErrorResponse {
  return Object.assign(new Error(error.details), {
    code: statusCode(error.status),
    details: error.details,
  });
}

function statusCode(value: GrpcStatus): number {
  switch (value) {
    case 'OK':
      return status.OK;
    case 'CANCELLED':
      return status.CANCELLED;
    case 'INVALID_ARGUMENT':
      return status.INVALID_ARGUMENT;
    case 'DEADLINE_EXCEEDED':
      return status.DEADLINE_EXCEEDED;
    case 'NOT_FOUND':
      return status.NOT_FOUND;
    case 'ALREADY_EXISTS':
      return status.ALREADY_EXISTS;
    case 'PERMISSION_DENIED':
      return status.PERMISSION_DENIED;
    case 'RESOURCE_EXHAUSTED':
      return status.RESOURCE_EXHAUSTED;
    case 'FAILED_PRECONDITION':
      return status.FAILED_PRECONDITION;
    case 'UNIMPLEMENTED':
      return status.UNIMPLEMENTED;
    case 'INTERNAL':
      return status.INTERNAL;
    case 'UNAVAILABLE':
      return status.UNAVAILABLE;
    case 'UNAUTHENTICATED':
      return status.UNAUTHENTICATED;
  }
}

function serverCredentials(options: 'insecure' | GrpcServerTlsOptions): ServerCredentials {
  if (options === 'insecure') return ServerCredentials.createInsecure();
  return ServerCredentials.createSsl(
    options.rootCertificates === undefined ? null : grpcBytes(options.rootCertificates),
    options.keyCertPairs.map(pair => ({
      private_key: grpcBytes(pair.privateKey),
      cert_chain: grpcBytes(pair.certificateChain),
    })),
    options.checkClientCertificate,
  );
}

function clientCredentials(options: 'insecure' | GrpcClientTlsOptions): ReturnType<typeof credentials.createSsl> {
  if (options === 'insecure') return credentials.createInsecure();
  const hasPrivateKey = options.privateKey !== undefined;
  const hasCertificate = options.certificateChain !== undefined;
  if (hasPrivateKey !== hasCertificate) {
    throw new Error('@zmdb/transport-grpc: gRPC client privateKey and certificateChain must be supplied together');
  }
  return credentials.createSsl(
    options.rootCertificates === undefined ? null : grpcBytes(options.rootCertificates),
    options.privateKey === undefined ? null : grpcBytes(options.privateKey),
    options.certificateChain === undefined ? null : grpcBytes(options.certificateChain),
  );
}

function bindServer(server: Server, address: string, creds: ServerCredentials): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.bindAsync(address, creds, (error, port) => {
      if (error === null) resolve(port);
      else reject(error);
    });
  });
}

function closeServer(server: Server, graceMs: number): Promise<void> {
  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new RangeError('@zmdb/transport-grpc: graceMs must be a non-negative finite number');
  }
  if (graceMs === 0) {
    server.forceShutdown();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.forceShutdown();
      resolve();
    }, graceMs);
    server.tryShutdown(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function clientCaller<S extends GrpcServiceDef>(
  client: Client,
  method: RuntimeMethod,
  options: GrpcClientOptions<S>,
): unknown {
  if (method.requestStream) {
    return method.responseStream
      ? (payload: AsyncIterable<unknown>, callOptions?: GrpcClientCallOptions) =>
          bidiCall(client, method, payload, options, callOptions)
      : (payload: AsyncIterable<unknown>, callOptions?: GrpcClientCallOptions) =>
          clientStreamCall(client, method, payload, options, callOptions);
  }
  return method.responseStream
    ? (payload: unknown, callOptions?: GrpcClientCallOptions) =>
        serverStreamCall(client, method, payload, options, callOptions)
    : (payload: unknown, callOptions?: GrpcClientCallOptions) =>
        unaryCall(client, method, payload, options, callOptions);
}

function unaryCall<S extends GrpcServiceDef>(
  client: Client,
  method: RuntimeMethod,
  payload: unknown,
  options: GrpcClientOptions<S>,
  callOptions?: GrpcClientCallOptions,
): Promise<unknown> {
  const request = method.validateRequest(payload);
  const deadlineMs = callDeadline(options.deadlineMs, callOptions);
  return new Promise<unknown>((resolve, reject) => {
    let observation: ClientObservation | undefined;
    let removeAbort = (): void => undefined;
    const call = client.makeUnaryRequest(
      method.path,
      value => grpcBytes(method.serializeRequest(method.validateRequest(value))),
      bytes => method.validateResponse(method.deserializeResponse(bytes)),
      request,
      outboundMetadata(callOptions?.metadata),
      { deadline: Date.now() + deadlineMs },
      (error, response) => {
        removeAbort();
        if (error !== null) {
          reject(observation?.error ?? error);
        } else {
          resolve(response);
        }
      },
    );
    observation = new ClientObservation(call, options.validateMetadata, callOptions);
    removeAbort = attachAbort(call, callOptions?.signal);
  });
}

function clientStreamCall<S extends GrpcServiceDef>(
  client: Client,
  method: RuntimeMethod,
  payload: AsyncIterable<unknown>,
  options: GrpcClientOptions<S>,
  callOptions?: GrpcClientCallOptions,
): Promise<unknown> {
  const deadlineMs = callDeadline(options.deadlineMs, callOptions);
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let observation: ClientObservation | undefined;
    let removeAbort = (): void => undefined;
    const call = client.makeClientStreamRequest(
      method.path,
      value => grpcBytes(method.serializeRequest(method.validateRequest(value))),
      bytes => method.validateResponse(method.deserializeResponse(bytes)),
      outboundMetadata(callOptions?.metadata),
      { deadline: Date.now() + deadlineMs },
      (error, response) => {
        if (settled) return;
        settled = true;
        removeAbort();
        if (error !== null) reject(observation?.error ?? error);
        else resolve(response);
      },
    );
    observation = new ClientObservation(call, options.validateMetadata, callOptions);
    removeAbort = attachAbort(call, callOptions?.signal);
    void pumpRequests(call, payload, method).catch(error => {
      if (settled) return;
      settled = true;
      removeAbort();
      call.cancel();
      reject(error);
    });
  });
}

function serverStreamCall<S extends GrpcServiceDef>(
  client: Client,
  method: RuntimeMethod,
  payload: unknown,
  options: GrpcClientOptions<S>,
  callOptions?: GrpcClientCallOptions,
): AsyncIterable<unknown> {
  const request = method.validateRequest(payload);
  const deadlineMs = callDeadline(options.deadlineMs, callOptions);
  const call = client.makeServerStreamRequest(
    method.path,
    value => grpcBytes(method.serializeRequest(method.validateRequest(value))),
    bytes => method.validateResponse(method.deserializeResponse(bytes)),
    request,
    outboundMetadata(callOptions?.metadata),
    { deadline: Date.now() + deadlineMs },
  );
  const observation = new ClientObservation(call, options.validateMetadata, callOptions);
  const removeAbort = attachAbort(call, callOptions?.signal);
  return clientResponses(call, observation, removeAbort);
}

function bidiCall<S extends GrpcServiceDef>(
  client: Client,
  method: RuntimeMethod,
  payload: AsyncIterable<unknown>,
  options: GrpcClientOptions<S>,
  callOptions?: GrpcClientCallOptions,
): AsyncIterable<unknown> {
  const deadlineMs = callDeadline(options.deadlineMs, callOptions);
  const call = client.makeBidiStreamRequest(
    method.path,
    value => grpcBytes(method.serializeRequest(method.validateRequest(value))),
    bytes => method.validateResponse(method.deserializeResponse(bytes)),
    outboundMetadata(callOptions?.metadata),
    { deadline: Date.now() + deadlineMs },
  );
  enableHalfOpenStream(call);
  const observation = new ClientObservation(call, options.validateMetadata, callOptions);
  const removeAbort = attachAbort(call, callOptions?.signal);
  const pumping = requestPump(call, payload, method);
  return clientResponses(call, observation, removeAbort, pumping);
}

function callDeadline(defaultMs: number, options?: GrpcClientCallOptions): number {
  const value = options?.deadlineMs ?? defaultMs;
  validatePositiveDuration(value, 'deadlineMs');
  return value;
}

function waitForClientDrain(call: ClientWritableStream<unknown> | ClientDuplexStream<unknown, unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      call.removeListener('drain', onDrain);
      call.removeListener('error', onError);
      call.removeListener('close', onClose);
    };
    call.once('drain', onDrain);
    call.once('error', onError);
    call.once('close', onClose);
  });
}

async function pumpRequests(
  call: ClientWritableStream<unknown> | ClientDuplexStream<unknown, unknown>,
  requests: AsyncIterable<unknown>,
  method: RuntimeMethod,
): Promise<void> {
  for await (const request of requests) {
    const valid = method.validateRequest(request);
    if (!call.write(valid)) await waitForClientDrain(call);
  }
  call.end();
}

function requestPump(
  call: ClientDuplexStream<unknown, unknown>,
  requests: AsyncIterable<unknown>,
  method: RuntimeMethod,
): RequestPump {
  let failure: ReturnType<RequestPump['failure']> = { failed: false };
  const done = pumpRequests(call, requests, method).catch(error => {
    failure = { failed: true, error };
    call.cancel();
  });
  return {
    done,
    failure: () => failure,
  };
}

async function* clientResponses(
  call: ClientReadableStream<unknown> | ClientDuplexStream<unknown, unknown>,
  observation: ClientObservation,
  removeAbort: () => void,
  pumping?: RequestPump,
): AsyncIterable<unknown> {
  let completed = false;
  try {
    for await (const response of call) {
      observation.throwIfInvalid();
      yield response;
    }
    if (pumping !== undefined) {
      await pumping.done;
      throwPumpFailure(pumping);
    }
    await observation.finished;
    observation.throwIfInvalid();
    completed = true;
  } catch (error) {
    observation.throwIfInvalid();
    if (pumping !== undefined) throwPumpFailure(pumping);
    throw error;
  } finally {
    removeAbort();
    if (!completed) call.cancel();
  }
}

function throwPumpFailure(pumping: RequestPump): void {
  const failure = pumping.failure();
  if (failure.failed) throw failure.error;
}

class ClientObservation {
  error: unknown;
  readonly finished: Promise<void>;
  readonly #finish: () => void;
  readonly #call: ClientSurfaceCall;
  readonly #validate: GrpcMetadataValidator;

  constructor(call: ClientSurfaceCall, validate: GrpcMetadataValidator, options?: GrpcClientCallOptions) {
    this.#call = call;
    this.#validate = validate;
    let finish = (): void => undefined;
    this.finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    this.#finish = finish;
    call.on('metadata', metadata => {
      this.#observe(metadata, options?.onMetadata);
    });
    call.on('status', result => {
      this.#observe(result.metadata, options?.onTrailer);
      this.#finish();
    });
  }

  throwIfInvalid(): void {
    if (this.error !== undefined) throw this.error;
  }

  #observe(metadata: Metadata, callback?: (metadata: GrpcMetadata) => void): void {
    if (this.error !== undefined) return;
    try {
      const value = validateMetadata(metadata, this.#validate);
      callback?.(value);
    } catch (error) {
      this.error = error;
      this.#call.cancel();
      this.#finish();
    }
  }
}

function attachAbort(call: ClientUnaryCall | ClientSurfaceCall, signal?: AbortSignal): () => void {
  if (signal === undefined) return () => undefined;
  const onAbort = (): void => {
    call.cancel();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}
