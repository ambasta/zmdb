import { transportExtension, type TransportStrategy } from '@zmdb/app/messaging';
import { createRedisStrategy, type RedisStrategyOptions } from '@zmdb/transport-redis';

const options: RedisStrategyOptions = {
  channels: ['orders.created'],
  onError: () => undefined,
};
const factory: typeof createRedisStrategy = createRedisStrategy;
const strategy: TransportStrategy = factory(options);
const extension = transportExtension({
  transports: [strategy],
  dispatcher: {
    onUnhandled: () => undefined,
    onInvalidPayload: () => undefined,
    onHandlerError: () => undefined,
    onUndeliverable: () => undefined,
  },
});

void [options, factory, strategy, extension];
