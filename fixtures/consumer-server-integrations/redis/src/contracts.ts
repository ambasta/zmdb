import { createRedisStrategy, type RedisStrategyOptions } from '@zmdb/transport-redis';

const options: RedisStrategyOptions = {
  channels: ['orders.created'],
  onError: () => undefined,
};
const factory: typeof createRedisStrategy = createRedisStrategy;

void [options, factory];
