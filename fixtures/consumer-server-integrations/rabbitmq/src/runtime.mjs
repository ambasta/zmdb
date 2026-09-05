import { connect as connectRabbit } from 'amqplib';

const rabbitmq = await import('@zmdb/transport-rabbitmq');

if (typeof rabbitmq.createRabbitMqStrategy !== 'function') {
  throw new Error('@zmdb/transport-rabbitmq omitted createRabbitMqStrategy');
}

const connection = process.env.ZMDB_RABBITMQ_URL;
if (connection === undefined) {
  console.warn(
    '[skip] @zmdb/transport-rabbitmq packed runtime: set ZMDB_RABBITMQ_URL for the required live-service lane',
  );
} else {
  const suffix = globalThis.crypto.randomUUID();
  const exchange = `zmdb.packed.${suffix}`;
  const queue = `${exchange}.worker`;
  const retryExchange = `${exchange}.retry`;
  const retryQueue = `${queue}.retry`;
  const deadExchange = `${exchange}.dead`;
  const deadQueue = `${queue}.dead`;
  const pattern = 'orders.created';
  const delivered = [];
  const errors = [];
  const strategy = rabbitmq.createRabbitMqStrategy({
    connection,
    exchange,
    queue,
    bindings: ['orders.*'],
    prefetch: 1,
    retry: { exchange: retryExchange, queue: retryQueue },
    deadLetter: { exchange: deadExchange, queue: deadQueue },
    durable: false,
    onError: error => errors.push(error),
  });
  const adminModel = await connectRabbit(connection);
  const admin = await adminModel.createChannel();

  try {
    await strategy.listen(message => {
      delivered.push(message.pattern);
      return Promise.resolve({
        settlement: { kind: 'ack' },
        ...(message.correlationId === undefined
          ? {}
          : {
              reply: {
                kind: 'result',
                correlationId: message.correlationId,
                payload: { echoed: message.payload },
              },
            }),
      });
    });
    await strategy.emit(pattern, { id: 1 });
    const reply = await strategy.send({
      pattern,
      payload: { id: 2 },
      correlationId: 'packed-request',
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });

    const deadline = Date.now() + 2_000;
    while (delivered.length < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (delivered.length !== 2 || reply.kind !== 'result' || reply.payload?.echoed?.id !== 2) {
      throw new Error(`@zmdb/transport-rabbitmq packed delivery failed: ${JSON.stringify({ delivered, reply })}`);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, '@zmdb/transport-rabbitmq reported errors during consumer lifecycle');
    }
    console.log('@zmdb/transport-rabbitmq packed consumer: live event and request/reply executed');
  } finally {
    await strategy.close(1_000);
    await admin.deleteQueue(queue).catch(() => undefined);
    await admin.deleteQueue(retryQueue).catch(() => undefined);
    await admin.deleteQueue(deadQueue).catch(() => undefined);
    await admin.deleteExchange(exchange).catch(() => undefined);
    await admin.deleteExchange(retryExchange).catch(() => undefined);
    await admin.deleteExchange(deadExchange).catch(() => undefined);
    await admin.close().catch(() => undefined);
    await adminModel.close().catch(() => undefined);
  }
}
