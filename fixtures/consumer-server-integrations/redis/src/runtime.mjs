import '@zmdb/app';
import {
  createEventPublisher,
  createMessageClient,
  EventPattern,
  MessagePattern,
  transportExtension,
} from '@zmdb/app/messaging';
import { createRedisStrategy } from '@zmdb/transport-redis';

if (typeof createRedisStrategy !== 'function') {
  throw new Error('@zmdb/transport-redis omitted createRedisStrategy');
}

const url = process.env.ZMDB_REDIS_URL;
if (url !== undefined) {
  const prefix = `zmdb.packed.${globalThis.crypto.randomUUID()}`;
  const eventPattern = `${prefix}.event`;
  const requestPattern = `${prefix}.request`;
  const events = [];

  class Consumer {
    event(context) {
      events.push(context.payload);
    }

    request(context) {
      return { echoed: context.payload };
    }
  }

  const metadata = Object.create(null);
  EventPattern(eventPattern, value => value)(Consumer.prototype.event, {
    name: 'event',
    metadata,
  });
  MessagePattern(requestPattern, value => value)(Consumer.prototype.request, {
    name: 'request',
    metadata,
  });
  Object.defineProperty(Consumer, Symbol.metadata, { value: metadata });

  const errors = [];
  const strategy = createRedisStrategy({
    channels: [eventPattern, requestPattern],
    connection: { url },
    onError: error => errors.push(error),
  });
  const extension = transportExtension({
    transports: [strategy],
    dispatcher: {
      onUnhandled: message => errors.push(new Error(`unhandled ${message.pattern}`)),
      onInvalidPayload: (_message, error) => errors.push(error),
      onHandlerError: (_message, error) => errors.push(error),
      onUndeliverable: (message, settlement) =>
        errors.push(new Error(`undeliverable ${message.pattern}: ${settlement.kind}`)),
    },
  });

  await extension.start({
    container: {},
    controllers: [new Consumer()],
    commands: [],
    observability: {},
  });
  try {
    const publisher = createEventPublisher(strategy);
    await publisher[eventPattern]({ id: 1 });
    const client = createMessageClient(strategy, {
      timeoutMs: 2_000,
      validate: {
        [requestPattern]: value => value,
      },
    });
    const reply = await client[requestPattern]({ id: 2 });

    const deadline = Date.now() + 2_000;
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (events.length !== 1 || events[0]?.id !== 1) {
      throw new Error('@zmdb/transport-redis packed event did not round-trip');
    }
    if (reply.echoed?.id !== 2) {
      throw new Error('@zmdb/transport-redis packed request did not round-trip');
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, '@zmdb/transport-redis packed consumer observed transport errors');
    }
  } finally {
    await extension.stop({ graceMs: 2_000 });
  }
}
