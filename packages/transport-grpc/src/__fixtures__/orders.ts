import type { GrpcLoadedService } from '@zmdb/protobuf';
import type { MinLength, Proto, ProtoField } from '@zmdb/schema-core/tags';

import { zmdbLoadGrpcServiceOrdersOrdersOrders } from './orders.zmdb.generated.js';

export interface GetOrder {
  readonly id: string & MinLength<1> & ProtoField<1>;
}

export interface Order {
  readonly id: string & ProtoField<1>;
  readonly total: number & Proto<'int32'> & ProtoField<2>;
}

export interface Chunk {
  readonly text: string & ProtoField<1>;
}

export interface UploadAck {
  readonly received: number & Proto<'int32'> & ProtoField<1>;
}

export type Orders = {
  readonly get: { readonly request: GetOrder; readonly response: Order };
  readonly upload: {
    readonly request: Chunk;
    readonly response: UploadAck;
    readonly requestStream: true;
  };
  readonly watch: {
    readonly request: GetOrder;
    readonly response: Order;
    readonly responseStream: true;
  };
  readonly chat: {
    readonly request: Chunk;
    readonly response: Chunk;
    readonly requestStream: true;
    readonly responseStream: true;
  };
};

export const ordersService: GrpcLoadedService<Orders> = zmdbLoadGrpcServiceOrdersOrdersOrders();
