// Private structural view of the generated gRPC artifact.
//
// The canonical public declarations live in `@zmdb/protobuf`. Keeping this copy
// private lets the pre-extraction web adapter consume the generated object without
// creating a production dependency from a core package to an optional integration.
// Issue #657 moves the adapter itself to `@zmdb/transport-grpc`.

export interface GrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

export type GrpcServiceDef = { readonly [method: string]: GrpcMethodDef };

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

export interface GrpcLoadedService<S extends GrpcServiceDef> {
  readonly name: string;
  readonly descriptor: string;
  readonly methods: { readonly [M in keyof S]: GrpcLoadedMethod<S[M]> };
}
