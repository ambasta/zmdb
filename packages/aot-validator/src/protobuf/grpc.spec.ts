import { describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';
import { buildValue } from './__testing__/fixture.js';

const GRPC_DECLARATIONS = String.raw`
  const zmdbProtoField: unique symbol;
  const zmdbProtoScalar: unique symbol;

  type ProtoField<N extends number> = { readonly [zmdbProtoField]?: N };
  type Proto<K extends string> = { readonly [zmdbProtoScalar]?: K };

  interface GrpcMethodDef {
    readonly request: unknown;
    readonly response: unknown;
    readonly requestStream?: true;
    readonly responseStream?: true;
  }
  type GrpcServiceDef = { readonly [method: string]: GrpcMethodDef };
  interface GrpcLoadedMethod<D extends GrpcMethodDef> {
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
  interface GrpcLoadedService<S extends GrpcServiceDef> {
    readonly name: string;
    readonly descriptor: string;
    readonly methods: { readonly [M in keyof S]: GrpcLoadedMethod<S[M]> };
  }

  function grpcDescriptor<S extends GrpcServiceDef>(service: string, pkg: string): string;
  function loadGrpcService<S extends GrpcServiceDef>(service: string, pkg: string): GrpcLoadedService<S>;

  interface GetOrder {
    id: string & ProtoField<1>;
  }
  interface Order {
    id: string & ProtoField<1>;
    total: number & Proto<'int32'> & ProtoField<2>;
  }
  interface Chunk {
    text: string & ProtoField<1>;
  }
  interface UploadAck {
    received: number & Proto<'int32'> & ProtoField<1>;
  }

  type Orders = {
    readonly get: { request: GetOrder; response: Order };
    readonly upload: { request: Chunk; response: UploadAck; requestStream: true };
    readonly watch: { request: GetOrder; response: Order; responseStream: true };
    readonly chat: { request: Chunk; response: Chunk; requestStream: true; responseStream: true };
  };
`;

interface GetOrder {
  readonly id: string;
}

interface Order {
  readonly id: string;
  readonly total: number;
}

interface LoadedMethod<Request, Response> {
  readonly path: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
  validateRequest(value: unknown): Request;
  serializeRequest(value: Request): Uint8Array;
  deserializeRequest(bytes: Uint8Array): Request;
  validateResponse(value: unknown): Response;
  serializeResponse(value: Response): Uint8Array;
  deserializeResponse(bytes: Uint8Array): Response;
}

interface LoadedOrders {
  readonly name: string;
  readonly descriptor: string;
  readonly methods: {
    readonly get: LoadedMethod<GetOrder, Order>;
    readonly upload: LoadedMethod<{ readonly text: string }, { readonly received: number }>;
    readonly watch: LoadedMethod<GetOrder, Order>;
    readonly chat: LoadedMethod<{ readonly text: string }, { readonly text: string }>;
  };
}

describe('gRPC build artifacts', () => {
  it('loads proto definitions at build time', () => {
    using project = FixtureProject.open({ declarations: GRPC_DECLARATIONS });
    const loaded = buildValue<LoadedOrders>(project, 'loadGrpcService<Orders>("Orders", "orders")').value;
    const descriptor = buildValue<string>(project, 'grpcDescriptor<Orders>("Orders", "orders")').value;

    expect(loaded.name).toBe('orders.Orders');
    expect(loaded.descriptor).toBe(descriptor);
    expect(descriptor).toContain('package orders;');
    expect(descriptor).toContain('rpc get (GetOrder) returns (Order);');
    expect(descriptor).toContain('rpc upload (stream Chunk) returns (UploadAck);');
    expect(descriptor).toContain('rpc watch (GetOrder) returns (stream Order);');
    expect(descriptor).toContain('rpc chat (stream Chunk) returns (stream Chunk);');
    expect(loaded.methods.upload).toMatchObject({
      path: '/orders.Orders/upload',
      requestStream: true,
      responseStream: false,
    });
  });

  it('generates request and response validators beside the codecs', () => {
    using project = FixtureProject.open({ declarations: GRPC_DECLARATIONS });
    const loaded = buildValue<LoadedOrders>(project, 'loadGrpcService<Orders>("Orders", "orders")').value;
    const request = { id: 'o1' };
    const response = { id: 'o1', total: 42 };

    expect(loaded.methods.get.deserializeRequest(loaded.methods.get.serializeRequest(request))).toEqual(request);
    expect(loaded.methods.get.deserializeResponse(loaded.methods.get.serializeResponse(response))).toEqual(response);
    expect(() => loaded.methods.get.validateRequest({ id: 1 })).toThrow('expected string');
    expect(() => loaded.methods.get.validateResponse({ id: 'o1', total: '42' })).toThrow('expected number');
  });
});
