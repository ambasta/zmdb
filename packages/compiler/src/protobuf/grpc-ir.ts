// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type TypeIR } from '@zmdb/schema/ir';

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
