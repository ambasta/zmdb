import type { ApplicationExtension } from '@zmdb/app';
import {
  GrpcError,
  bindGrpcService,
  createGrpcClient,
  grpcExtension,
  type GrpcBinding,
  type GrpcClient,
  type GrpcClientOptions,
  type GrpcHandlers,
  type GrpcServerOptions,
  type GrpcServiceSpec,
  type GrpcStatus,
} from '@zmdb/transport-grpc';

type Orders = {
  readonly get: {
    readonly request: { readonly id: string };
    readonly response: { readonly id: string };
  };
};

const bind: (service: GrpcServiceSpec<Orders>, handlers: GrpcHandlers<Orders>) => GrpcBinding = bindGrpcService;
const client: (options: GrpcClientOptions<Orders>) => GrpcClient<Orders> = createGrpcClient;
const extension: (options: GrpcServerOptions) => ApplicationExtension = grpcExtension;
const status: GrpcStatus = 'INTERNAL';
const error: GrpcError = new GrpcError(status, 'safe');

void [bind, client, extension, error];
