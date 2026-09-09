// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { TransportStrategy } from '@zmdb/app/messaging';
import type { Kafka } from 'kafkajs';

import { createKafkaStrategy, type KafkaStrategyOptions } from './index.js';

declare const client: Kafka;
const options = {
  client,
  groupId: 'orders.worker',
  topics: ['orders'] as const,
  deadLetterTopic: 'orders.dead',
  partitionsConsumedConcurrently: 2,
  onError: (_error: unknown): void => undefined,
} satisfies KafkaStrategyOptions;

export const strategy: TransportStrategy = createKafkaStrategy(options);
export const configured: TransportStrategy = createKafkaStrategy({
  ...options,
  name: 'orders.kafka',
  fromBeginning: true,
  sessionTimeoutMs: 30000,
  heartbeatIntervalMs: 1000,
  errorRetryMs: 200,
});

// @ts-expect-error A consumer group is mandatory.
createKafkaStrategy({
  client,
  topics: ['orders'],
  deadLetterTopic: 'dead',
  partitionsConsumedConcurrently: 1,
  onError: options.onError,
});
// @ts-expect-error A configured Kafka SDK factory cannot be replaced by a URL.
createKafkaStrategy({ ...options, client: 'localhost:9092' });
// @ts-expect-error Partition concurrency is an integer-valued number contract.
createKafkaStrategy({ ...options, partitionsConsumedConcurrently: '2' });
// @ts-expect-error Dead-letter topic ownership is explicit.
createKafkaStrategy({
  client,
  groupId: 'worker',
  topics: ['orders'],
  partitionsConsumedConcurrently: 1,
  onError: options.onError,
});
// @ts-expect-error Error reporting is a required callback.
createKafkaStrategy({ ...options, onError: undefined });
// @ts-expect-error Kafka event transport has no request/response configuration.
createKafkaStrategy({ ...options, requestResponse: true });
// @ts-expect-error Internal implementation paths are not published entries.
import type { KafkaStrategyOptions as PrivateKafkaOptions } from '@zmdb/transport-kafka/src/index.js';
// @ts-expect-error Historical transport forwarding paths are not public.
import type { createKafkaStrategy as HistoricalKafkaStrategy } from '@zmdb/web/transports/kafka';
export type RefusedEntries = [typeof HistoricalKafkaStrategy, PrivateKafkaOptions];
