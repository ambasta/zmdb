const nats = await import('@zmdb/transport-nats');

if (typeof nats.createNatsStrategy !== 'function') {
  throw new Error('@zmdb/transport-nats omitted createNatsStrategy');
}

const url = process.env.ZMDB_NATS_URL;
if (url !== undefined) {
  const { transportExtension } = await import('@zmdb/app/messaging');
  const errors = [];
  const strategy = nats.createNatsStrategy({
    connection: { servers: url },
    subscriptions: [],
    onError: error => errors.push(error),
  });
  const extension = transportExtension({
    transports: [strategy],
    dispatcher: {
      onUnhandled: () => undefined,
      onInvalidPayload: () => undefined,
      onHandlerError: () => undefined,
      onUndeliverable: () => undefined,
    },
  });

  await extension.start({
    container: {},
    controllers: [],
    commands: [],
    observability: {},
  });
  await extension.stop({ graceMs: 1_000 });
  if (errors.length > 0) {
    throw new AggregateError(errors, '@zmdb/transport-nats reported errors during consumer lifecycle');
  }
}
