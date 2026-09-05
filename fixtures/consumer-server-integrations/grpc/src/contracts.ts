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

interface Orders {
  readonly get: {
    readonly request: { readonly id: string };
    readonly response: { readonly id: string };
  };
}

const bind: (service: GrpcServiceSpec<Orders>, handlers: GrpcHandlers<Orders>) => GrpcBinding = bindGrpcService;
const client: (options: GrpcClientOptions<Orders>) => GrpcClient<Orders> = createGrpcClient;
const extension: (options: GrpcServerOptions) => ReturnType<typeof grpcExtension> = grpcExtension;
const status: GrpcStatus = 13;
const error: GrpcError = new GrpcError(status, 'safe');

void [bind, client, extension, error];
