/**
 * Encode `value` as protobuf at build time.
 *
 * The type argument and its field tags do not exist at runtime, so the build plugin
 * replaces this call with a generated encoder. An unreplaced call cannot guess a wire
 * contract and fails by name.
 */
export function protoEncode<T>(_value: T): Uint8Array {
  throw new Error(
    'protoEncode<T>(value) was not replaced at build time. It is compiled away by @zmdb/compiler ' +
      '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
      'be read at runtime, so there is no protobuf wire contract to fall back to.',
  );
}

/**
 * Decode protobuf `bytes` as `T` at build time.
 *
 * The type argument and its field tags do not exist at runtime, so the build plugin
 * replaces this call with a generated decoder. An unreplaced call cannot guess a wire
 * contract and fails by name.
 */
export function protoDecode<T>(_bytes: Uint8Array): T {
  throw new Error(
    'protoDecode<T>(bytes) was not replaced at build time. It is compiled away by @zmdb/compiler ' +
      '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
      'be read at runtime, so there is no protobuf wire contract to fall back to.',
  );
}

/**
 * Emit the proto3 descriptor for `T` at build time.
 *
 * A type argument does not exist at runtime, so an untransformed call cannot provide
 * a partial fallback. The build plugin replaces this call with a string literal.
 */
export function protoDescriptor<_T>(): string {
  throw new Error(
    'protoDescriptor<T>() was not replaced at build time. It is compiled away by @zmdb/compiler ' +
      '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
      'be read at runtime, so there is no descriptor to fall back to.',
  );
}

/**
 * One gRPC method declaration. Request and response types are reflected by the
 * AOT transformer; the stream flags are present-or-absent so there is one
 * spelling for each call shape.
 */
export interface GrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

/** A closed service declaration. Concrete services must be type aliases. */
export type GrpcServiceDef = { readonly [method: string]: GrpcMethodDef };

/** Generated codecs and validators for one method. */
export interface GrpcLoadedMethod<D extends GrpcMethodDef> {
  readonly path: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
  validateRequest(value: unknown): D['request'];
  serializeRequest(value: D['request']): Uint8Array;
  deserializeRequest(bytes: Uint8Array): D['request'];
  validateResponse(value: unknown): D['response'];
  serializeResponse(value: D['response']): Uint8Array;
  deserializeResponse(bytes: Uint8Array): D['response'];
}

/**
 * A build-time service artifact. No descriptor is parsed at runtime: the AOT
 * transformer emits this object and its straight-line protobuf codecs.
 */
export interface GrpcLoadedService<S extends GrpcServiceDef> {
  readonly name: string;
  readonly descriptor: string;
  readonly methods: { readonly [M in keyof S]: GrpcLoadedMethod<S[M]> };
}

/**
 * Emit a complete proto3 file for `S` at build time.
 *
 * An untransformed call cannot recover `S`, so it fails by name.
 */
export function grpcDescriptor<_S extends GrpcServiceDef>(_service: string, _package: string): string {
  throw new Error(
    'grpcDescriptor<S>(service, package) was not replaced at build time. It is compiled away by ' +
      '@zmdb/compiler (the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument ' +
      'cannot be read at runtime, so there is no gRPC descriptor to fall back to.',
  );
}

/**
 * Load a typed gRPC service from `S` at build time.
 *
 * "Load" means emit the descriptor, codecs and validators from TypeScript. It
 * never reads or parses a `.proto` file.
 */
export function loadGrpcService<S extends GrpcServiceDef>(_service: string, _package: string): GrpcLoadedService<S> {
  throw new Error(
    'loadGrpcService<S>(service, package) was not replaced at build time. It is compiled away by ' +
      '@zmdb/compiler (the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument ' +
      'cannot be read at runtime, so there is no gRPC service definition to fall back to.',
  );
}
