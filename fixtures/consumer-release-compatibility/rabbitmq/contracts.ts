import { createRabbitMqStrategy, type RabbitMqStrategyOptions } from '@zmdb/transport-rabbitmq';

const options: RabbitMqStrategyOptions = {
  connection: 'amqp://127.0.0.1',
  exchange: 'compatibility',
  queue: 'compatibility.worker',
  deadLetter: { exchange: 'compatibility.dead', queue: 'compatibility.dead.worker' },
  bindings: ['orders.*'],
  prefetch: 1,
  onError: () => undefined,
};
const strategy = createRabbitMqStrategy(options);
const close: Promise<void> = strategy.close(1000);
void close;

// @ts-expect-error Broker addresses must be strings.
const badAddress: RabbitMqStrategyOptions = { ...options, connection: 17 };
// @ts-expect-error Acknowledgement results are an exact protocol discriminated union.
void strategy.listen(async () => ({ settlement: { kind: 'forget' } }));
void badAddress;
