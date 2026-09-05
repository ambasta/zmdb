import type { TransportErrorSink, TransportStrategy } from '@zmdb/app/messaging';
import type { RedisClientOptions } from 'redis';

import type { createRedisStrategy, RedisStrategyOptions } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type ExpectedOptions = {
  readonly channels?: readonly string[];
  readonly channelPatterns?: readonly string[];
  readonly connection?: RedisClientOptions;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  readonly replyPrefix?: string;
};

export type _Options = Expect<Equal<RedisStrategyOptions, ExpectedOptions>>;
export type _FactoryParameter = Expect<Equal<Parameters<typeof createRedisStrategy>, [RedisStrategyOptions]>>;
export type _FactoryReturn = Expect<Equal<ReturnType<typeof createRedisStrategy>, TransportStrategy>>;
export type _OnErrorIsRequired = Expect<Equal<{} extends RedisStrategyOptions ? true : false, false>>;
