import assert from 'node:assert/strict';

import { createRabbitMqStrategy } from '@zmdb/transport-rabbitmq';
import { connect } from 'amqplib';

const connection = process.env.ZMDB_RABBITMQ_URL;
assert.ok(connection, 'release compatibility requires its assigned RabbitMQ service');
const name = `zmdb.release.${globalThis.crypto.randomUUID()}`;
const exchange = name;
const queue = `${name}.worker`;
const retry = { exchange: `${name}.retry`, queue: `${name}.retry.worker` };
const deadLetter = { exchange: `${name}.dead`, queue: `${name}.dead.worker` };
const errors = [];
const observed = [];
const strategy = createRabbitMqStrategy({
  connection,
  exchange,
  queue,
  bindings: ['orders.*'],
  retry,
  deadLetter,
  durable: false,
  prefetch: 1,
  onError: error => errors.push(error),
});
let adminConnection;
let admin;
const failures = [];
try {
  adminConnection = await connect(connection);
  admin = await adminConnection.createChannel();
  await strategy.listen(message => {
    observed.push(message);
    return Promise.resolve({
      settlement: { kind: 'ack' },
      ...(message.correlationId === undefined
        ? {}
        : {
            reply: { kind: 'result', correlationId: message.correlationId, payload: { received: message.payload } },
          }),
    });
  });
  await strategy.emit('orders.created', { id: 17, label: 'release-π' });
  const reply = await strategy.send({
    pattern: 'orders.created',
    payload: { id: 23, label: 'wire-π' },
    correlationId: `${name}.request`,
    timeoutMs: 5_000,
    signal: new AbortController().signal,
  });
  assert.deepEqual(reply, {
    kind: 'result',
    correlationId: `${name}.request`,
    payload: { received: { id: 23, label: 'wire-π' } },
  });
  const deadline = Date.now() + 5_000;
  while (observed.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(
    observed.map(message => message.payload),
    [
      { id: 17, label: 'release-π' },
      { id: 23, label: 'wire-π' },
    ],
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failures.push(error);
} finally {
  const cleanup = [() => strategy.close(1_000)];
  if (admin !== undefined) {
    for (const queueName of [queue, retry.queue, deadLetter.queue]) cleanup.push(() => admin.deleteQueue(queueName));
    for (const exchangeName of [exchange, retry.exchange, deadLetter.exchange])
      cleanup.push(() => admin.deleteExchange(exchangeName));
    cleanup.push(() => admin.close());
  }
  if (adminConnection !== undefined) cleanup.push(() => adminConnection.close());
  for (const close of cleanup) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
}
if (failures.length > 0) throw new AggregateError(failures, 'RabbitMQ consumer or cleanup failed');
