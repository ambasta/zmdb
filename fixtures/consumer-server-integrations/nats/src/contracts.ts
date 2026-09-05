import { createNatsStrategy, type NatsStrategyOptions, type NatsSubscription } from '@zmdb/transport-nats';

const subscription: NatsSubscription = { subject: 'orders.*', queue: 'workers' };
const options: NatsStrategyOptions = {
  subscriptions: [subscription],
  onError: () => undefined,
};
const factory: typeof createNatsStrategy = createNatsStrategy;

void [options, factory];
