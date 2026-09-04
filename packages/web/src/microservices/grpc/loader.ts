// The build-time gRPC loader lives with the AOT emitter. Re-exporting it from
// the web subpath gives applications one import while preserving one TypeIR
// walker and no runtime `.proto` parser.

export {
  grpcDescriptor,
  loadGrpcService,
  type GrpcLoadedMethod,
  type GrpcLoadedService,
  type GrpcMethodDef,
  type GrpcServiceDef,
} from '@zmdb/aot-validator';
