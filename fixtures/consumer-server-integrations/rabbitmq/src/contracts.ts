import {
  createRabbitMqStrategy,
  type RabbitMqDeadLetterOptions,
  type RabbitMqRetryOptions,
  type RabbitMqStrategyOptions,
} from '@zmdb/transport-rabbitmq';

const deadLetter: RabbitMqDeadLetterOptions = { exchange: 'orders.dead', queue: 'orders.dead' };
const retry: RabbitMqRetryOptions = { exchange: 'orders.retry', queue: 'orders.retry' };
const options: RabbitMqStrategyOptions = {
  bindings: ['orders.*'],
  connection: 'amqp://localhost',
  deadLetter,
  exchange: 'orders',
  onError: () => undefined,
  prefetch: 1,
  queue: 'orders.worker',
  retry,
};
const factory: typeof createRabbitMqStrategy = createRabbitMqStrategy;

void [options, factory];
