import type {
  GrpcLoadedMethod,
  GrpcLoadedService,
  GrpcMethodDef,
  GrpcServiceDef,
  grpcDescriptor,
  loadGrpcService,
  protoDecode,
  protoDescriptor,
  protoEncode,
} from './index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type FrozenProtoEncode = <T>(value: T) => Uint8Array;
type FrozenProtoDecode = <T>(bytes: Uint8Array) => T;
type FrozenProtoDescriptor = <_T>() => string;
type FrozenMethodDef = {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
};
type FrozenServiceDef = { readonly [method: string]: FrozenMethodDef };
type FrozenLoadedMethod<D extends GrpcMethodDef> = {
  readonly path: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
  validateRequest(value: unknown): D['request'];
  serializeRequest(value: D['request']): Uint8Array;
  deserializeRequest(bytes: Uint8Array): D['request'];
  validateResponse(value: unknown): D['response'];
  serializeResponse(value: D['response']): Uint8Array;
  deserializeResponse(bytes: Uint8Array): D['response'];
};
type FrozenDescriptor = <_S extends GrpcServiceDef>(service: string, pkg: string) => string;
type FrozenLoader = <S extends GrpcServiceDef>(service: string, pkg: string) => GrpcLoadedService<S>;

export type ProtoEncodeSignature = Expect<Equal<typeof protoEncode, FrozenProtoEncode>>;
export type ProtoDecodeSignature = Expect<Equal<typeof protoDecode, FrozenProtoDecode>>;
export type ProtoDescriptorSignature = Expect<Equal<typeof protoDescriptor, FrozenProtoDescriptor>>;
export type MethodDefShape = Expect<Equal<GrpcMethodDef, FrozenMethodDef>>;
export type ServiceDefShape = Expect<Equal<GrpcServiceDef, FrozenServiceDef>>;
export type LoadedMethodShape = Expect<Equal<GrpcLoadedMethod<GrpcMethodDef>, FrozenLoadedMethod<GrpcMethodDef>>>;
export type DescriptorSignature = Expect<Equal<typeof grpcDescriptor, FrozenDescriptor>>;
export type LoaderSignature = Expect<Equal<typeof loadGrpcService, FrozenLoader>>;
