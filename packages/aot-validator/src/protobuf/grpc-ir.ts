import type { TypeIR } from '@zmdb/schema-core/ir';

/** One service method reflected into the existing protobuf message IR. */
export interface GrpcMethodIR {
  readonly name: string;
  readonly request: TypeIR;
  readonly requestName: string;
  readonly response: TypeIR;
  readonly responseName: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
}

/** The build-time portion of a gRPC service declaration. */
export interface GrpcServiceIR {
  readonly methods: readonly GrpcMethodIR[];
}
