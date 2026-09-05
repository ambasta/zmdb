import {
  grpcDescriptor,
  loadGrpcService,
  protoDecode,
  protoDescriptor,
  protoEncode,
  type GrpcLoadedService,
  type GrpcMethodDef,
  type GrpcServiceDef,
} from '@zmdb/protobuf';
import { ProtoReader, ProtoWriter } from '@zmdb/protobuf/wire';

interface Request {
  readonly id: string;
}

interface Response {
  readonly accepted: boolean;
}

interface Method extends GrpcMethodDef {
  readonly request: Request;
  readonly response: Response;
}

type Service = GrpcServiceDef & { readonly get: Method };

const encoder: typeof protoEncode<Request> = protoEncode<Request>;
const decoder: typeof protoDecode<Request> = protoDecode<Request>;
const descriptor: typeof protoDescriptor<Request> = protoDescriptor<Request>;
const grpc: typeof grpcDescriptor<Service> = grpcDescriptor<Service>;
const loader: typeof loadGrpcService<Service> = loadGrpcService<Service>;
const loaded: GrpcLoadedService<Service> | undefined = undefined;
const reader: ProtoReader = new ProtoReader();
const writer: ProtoWriter = new ProtoWriter();

void [encoder, decoder, descriptor, grpc, loader, loaded, reader, writer];
