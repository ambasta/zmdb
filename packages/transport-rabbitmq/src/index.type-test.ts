import type { TransportErrorSink, TransportStrategy } from '@zmdb/app/messaging';
import type { SocketOptions } from 'amqplib';

import type {
  createRabbitMqStrategy,
  RabbitMqDeadLetterOptions,
  RabbitMqRetryOptions,
  RabbitMqStrategyOptions,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

interface FrozenDeadLetterOptions {
  readonly exchange: string;
  readonly queue: string;
  readonly binding?: string;
}

interface FrozenRetryOptions {
  readonly exchange?: string;
  readonly queue?: string;
}

interface FrozenStrategyOptions {
  readonly bindings: readonly string[];
  readonly connection: string;
  readonly deadLetter: RabbitMqDeadLetterOptions;
  readonly durable?: boolean;
  readonly exchange: string;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  readonly prefetch: number;
  readonly queue: string;
  readonly retry?: RabbitMqRetryOptions;
  readonly socketOptions?: SocketOptions;
}

type FrozenFactory = (options: RabbitMqStrategyOptions) => TransportStrategy;

export type DeadLetterShape = Expect<Equal<RabbitMqDeadLetterOptions, FrozenDeadLetterOptions>>;
export type RetryShape = Expect<Equal<RabbitMqRetryOptions, FrozenRetryOptions>>;
export type OptionsShape = Expect<Equal<RabbitMqStrategyOptions, FrozenStrategyOptions>>;
export type FactoryShape = Expect<Equal<typeof createRabbitMqStrategy, FrozenFactory>>;
