const nats = await import('@zmdb/transport-nats');

if (typeof nats.createNatsStrategy !== 'function') {
  throw new Error('@zmdb/transport-nats omitted createNatsStrategy');
}

const url = process.env.ZMDB_NATS_URL;
if (url === undefined) {
  console.warn('[skip] @zmdb/transport-nats packed runtime: set ZMDB_NATS_URL for the required live-service lane');
} else {
  const prefix = `zmdb.packed.${globalThis.crypto.randomUUID()}`;
  const delivered = [];
  const errors = [];
  const strategy = nats.createNatsStrategy({
    connection: { servers: url },
    subscriptions: [{ subject: `${prefix}.*`, queue: `${prefix}.workers` }],
    onError: error => errors.push(error),
  });

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
    await strategy.emit(`${prefix}.event`, { id: 1 });
    const reply = await strategy.send({
      pattern: `${prefix}.request`,
      payload: { id: 2 },
      correlationId: 'packed-request',
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });

    const deadline = Date.now() + 2_000;
    while (delivered.length < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (
      !delivered.includes(`${prefix}.event`) ||
      !delivered.includes(`${prefix}.request`) ||
      reply.kind !== 'result' ||
      reply.payload?.echoed?.id !== 2
    ) {
      throw new Error(`@zmdb/transport-nats packed delivery failed: ${JSON.stringify({ delivered, reply })}`);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, '@zmdb/transport-nats reported errors during consumer lifecycle');
    }
    console.log('@zmdb/transport-nats packed consumer: live event and request/reply executed');
  } finally {
    await strategy.close(1_000);
  }
}
