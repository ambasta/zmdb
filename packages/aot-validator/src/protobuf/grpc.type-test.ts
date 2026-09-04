import type {
  GrpcLoadedService,
  GrpcMethodDef,
  GrpcServiceDef,
  grpcDescriptor,
  loadGrpcService,
} from '@zmdb/aot-validator';
import type { Equal, Expect } from '@zmdb/schema-core';

type Orders = {
  readonly get: {
    readonly request: { readonly id: string };
    readonly response: { readonly id: string };
  };
};

type FrozenMethodDef = {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
};

type FrozenServiceDef = { readonly [method: string]: FrozenMethodDef };
type FrozenDescriptor = <_S extends GrpcServiceDef>(service: string, pkg: string) => string;
type FrozenLoader = <S extends GrpcServiceDef>(service: string, pkg: string) => GrpcLoadedService<S>;

export type MethodDefShape = Expect<Equal<GrpcMethodDef, FrozenMethodDef>>;
export type ServiceDefShape = Expect<Equal<GrpcServiceDef, FrozenServiceDef>>;
export type DescriptorSignature = Expect<Equal<typeof grpcDescriptor, FrozenDescriptor>>;
export type LoaderSignature = Expect<Equal<typeof loadGrpcService, FrozenLoader>>;
export type LoadedMethodsAreTotal = Expect<Equal<keyof GrpcLoadedService<Orders>['methods'], 'get'>>;
