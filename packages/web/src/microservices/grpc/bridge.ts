import type { GrpcBinding, GrpcServerOptions } from './types.js';

export interface OpenedGrpcServer {
  readonly port: number;
  close(graceMs: number): Promise<void>;
}

export type GrpcServerOpener = (options: GrpcServerOptions) => Promise<OpenedGrpcServer>;

export const GRPC_SERVER_OPENER = Symbol('zmdb.web.grpc.server-opener');

interface OpenableGrpcBinding extends GrpcBinding {
  readonly [GRPC_SERVER_OPENER]: GrpcServerOpener;
}

function isOpenable(binding: GrpcBinding): binding is OpenableGrpcBinding {
  return GRPC_SERVER_OPENER in binding && typeof binding[GRPC_SERVER_OPENER] === 'function';
}

export function openBoundGrpcServer(options: GrpcServerOptions): Promise<OpenedGrpcServer> {
  const first = options.bindings[0];
  if (first === undefined) {
    throw new RangeError('@zmdb/web: a gRPC server requires at least one binding');
  }
  if (!isOpenable(first)) {
    throw new TypeError('@zmdb/web: gRPC bindings must be created by bindGrpcService');
  }

  const opener = first[GRPC_SERVER_OPENER];
  for (const binding of options.bindings.slice(1)) {
    if (!isOpenable(binding) || binding[GRPC_SERVER_OPENER] !== opener) {
      throw new TypeError('@zmdb/web: gRPC bindings must be created by one bindGrpcService implementation');
    }
  }
  return opener(options);
}
