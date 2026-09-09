// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/messaging — curated transport-neutral messaging facade.
export {
  EventPattern,
  InFlight,
  MessageCorrelationError,
  MessagePattern,
  MessageRemoteError,
  MessageTimeoutError,
  TransportUnsupportedError,
  abortError,
  createEventPublisher,
  createMessageClient,
  createMessageDispatcher,
  decodeDelivery,
  decodeReply,
  encodeDelivery,
  encodeReply,
  getMessagePatterns,
  reportTransportError,
  transportExtension,
  withinGrace,
} from '@zmdb/app/messaging';
export type {
  ClientPatterns,
  DeliveryMetadata,
  DispatchOutcome,
  DispatcherOptions,
  EventPatterns,
  EventPublisher,
  MessageClient,
  MessageClientOptions,
  MessageContext,
  MessageDispatcher,
  MessageReply,
  RawMessage,
  ResolvedMessagePattern,
  Settlement,
  TransportCapabilities,
  TransportErrorSink,
  TransportRequest,
  TransportStrategy,
  WithHeaders,
} from '@zmdb/app/messaging';
