import type { NodeConnectionOptions } from '@nats-io/transport-node';
import { transportExtension } from '@zmdb/app/messaging';
import { createNatsStrategy, type NatsStrategyOptions, type NatsSubscription } from '@zmdb/transport-nats';

const subscription: NatsSubscription = { subject: 'orders.*', queue: 'workers' };
const connection = { servers: ['nats://127.0.0.1:4222'] } satisfies NodeConnectionOptions;
const options: NatsStrategyOptions = {
  connection,
  subscriptions: [subscription],
  onError: () => undefined,
};
const factory: typeof createNatsStrategy = createNatsStrategy;
const extension = transportExtension({
  transports: [createNatsStrategy(options)],
  dispatcher: {
    onUnhandled: () => undefined,
    onInvalidPayload: () => undefined,
    onHandlerError: () => undefined,
    onUndeliverable: () => undefined,
  },
});

void [options, factory, extension];
