import assert from 'node:assert/strict';

import { CreateQueueCommand, DeleteQueueCommand, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { createApplication, Module } from '@zmdb/app';
import { createEventPublisher, EventPattern, transportExtension } from '@zmdb/app/messaging';

import { sdk, waitFor } from './broker.mjs';
import { options } from './runtime.mjs';

export async function exerciseApplication(createSqsStrategy, endpoint) {
  const client = sdk(endpoint);
  const urls = [];
  let app;
  const events = [],
    errors = [],
    lifecycle = [];
  try {
    for (const kind of ['app', 'dead']) {
      const result = await client.send(
        new CreateQueueCommand({ QueueName: `zmdb760-${kind}-${globalThis.crypto.randomUUID()}` }),
      );
      urls.push(result.QueueUrl);
    }
    class Consumer {
      onModuleInit() {
        lifecycle.push('controller-init');
      }
      event(context) {
        events.push(context.payload);
      }
      onShutdown() {
        lifecycle.push('controller-shutdown');
      }
    }
    const metadata = Object.create(null);
    EventPattern('orders.created', value => {
      assert.equal(typeof value?.id, 'number');
      return value;
    })(Consumer.prototype.event, { name: 'event', metadata });
    Object.defineProperty(Consumer, Symbol.metadata, { value: metadata });
    // oxlint-disable-next-line typescript/no-extraneous-class -- Module requires a constructor identity.
    class Root {}
    const rootMetadata = Object.create(null);
    Object.defineProperty(Root, Symbol.metadata, { value: rootMetadata });
    Module({ controllers: [Consumer] })(Root, { metadata: rootMetadata });
    const strategy = createSqsStrategy(options(client, urls[0], urls[1], error => errors.push(error)));
    app = createApplication(Root, {
      graceMs: 500,
      extensions: [
        transportExtension({
          transports: [strategy],
          dispatcher: {
            onUnhandled: message => errors.push(message),
            onInvalidPayload: (_message, error) => errors.push(error),
            onHandlerError: (_message, error) => errors.push(error),
          },
        }),
      ],
    });
    await app.init();
    await createEventPublisher(strategy)['orders.created']({ id: 11 });
    await waitFor(() => assert.deepEqual(events, [{ id: 11 }]));
    await app[Symbol.asyncDispose]();
    assert.deepEqual(lifecycle, ['controller-init', 'controller-shutdown']);
    assert.deepEqual(errors, []);
    await client.send(new ListQueuesCommand({}));
    return { validatedEvent: true, appShutdown: true, callerClientUsable: true };
  } finally {
    const closed = await Promise.allSettled([app?.[Symbol.asyncDispose]()]);
    let deleted;
    try {
      deleted = await Promise.allSettled(urls.map(QueueUrl => client.send(new DeleteQueueCommand({ QueueUrl }))));
    } finally {
      client.destroy();
    }
    assert.deepEqual(
      [...closed, ...deleted].filter(result => result.status === 'rejected'),
      [],
      'app fixture cleanup failed',
    );
  }
}
