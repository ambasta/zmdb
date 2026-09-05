const grpc = await import('@zmdb/transport-grpc');

for (const name of ['grpcExtension', 'bindGrpcService', 'createGrpcClient', 'GrpcError']) {
  if (typeof grpc[name] !== 'function') throw new Error(`@zmdb/transport-grpc omitted ${name}`);
}
