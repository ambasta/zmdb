import { createApplication } from '@zmdb/app';
import { transportExtension, type TransportStrategy } from '@zmdb/app/messaging';
import { createKafkaStrategy, type KafkaStrategyOptions } from '@zmdb/transport/kafka';
import { Kafka } from 'kafkajs';

const options = {
  client: new Kafka({ clientId: 'installed-types', brokers: ['127.0.0.1:9092'] }),
  groupId: 'consumer',
  topics: ['orders'],
  deadLetterTopic: 'orders.dead',
  partitionsConsumedConcurrently: 2,
  onError: (_error: unknown): void => undefined,
} satisfies KafkaStrategyOptions;
const strategy: TransportStrategy = createKafkaStrategy(options);
export const extension = transportExtension({
  transports: [strategy],
  dispatcher: {
    onUnhandled: () => undefined,
    onInvalidPayload: () => undefined,
    onHandlerError: () => undefined,
  },
});
export const applicationFactory: typeof createApplication = createApplication;
// @ts-expect-error Consumer group selection is mandatory at the installed boundary.
createKafkaStrategy({
  client: options.client,
  topics: [],
  deadLetterTopic: 'dead',
  partitionsConsumedConcurrently: 2,
  onError: options.onError,
});
// @ts-expect-error The selected factory requires the real Kafka SDK type.
createKafkaStrategy({ ...options, client: {} });
// @ts-expect-error There is no request/response option.
createKafkaStrategy({ ...options, requestResponse: true });
// @ts-expect-error Source/private subpaths cannot be imported by installed consumers.
import type { KafkaStrategyOptions as PrivateOptions } from '@zmdb/transport/kafka/src/index.js';
// @ts-expect-error The obsolete web-owned transport entry does not exist.
import type { createKafkaStrategy as OldFactory } from '@zmdb/web/transports/kafka';
export type Refused = [PrivateOptions, typeof OldFactory];
