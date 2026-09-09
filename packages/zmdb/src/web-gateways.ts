// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/web/gateways — curated WebSocket and SSE declaration facade.
export { Gateway, Subscribe, createGatewayDispatcher, getSubscriptions, sseStream } from '@zmdb/web/gateways';
export type { GatewayDispatcher, MessageCtx, SseFrame, Subscription } from '@zmdb/web/gateways';
