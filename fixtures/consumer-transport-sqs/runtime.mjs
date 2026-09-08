import assert from 'node:assert/strict';

import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
} from '@aws-sdk/client-sqs';

import { sdk, waitFor } from './broker.mjs';

export const options = (client, queueUrl, deadLetterQueueUrl, onError) => ({
  client,
  queueUrl,
  deadLetterQueueUrl,
  waitTimeSeconds: 1,
  visibilityTimeoutSeconds: 1,
  maxInFlight: 2,
  requestTimeoutMs: 2500,
  pollRetryMs: 30,
  onError,
});

export async function exerciseBroker(createSqsStrategy, endpoint) {
  const observer = sdk(endpoint);
  const client = sdk(endpoint);
  const queueUrls = [];
  const strategies = [];
  const errors = [];
  try {
    for (const suffix of ['source', 'dead']) {
      const result = await observer.send(
        new CreateQueueCommand({ QueueName: `zmdb760-${globalThis.crypto.randomUUID()}-${suffix}` }),
      );
      assert.equal(typeof result.QueueUrl, 'string');
      queueUrls.push(result.QueueUrl);
    }
    const [queueUrl, deadLetterQueueUrl] = queueUrls;
    const deliveries = [];
    const strategy = createSqsStrategy(options(client, queueUrl, deadLetterQueueUrl, error => errors.push(error)));
    strategies.push(strategy);
    await strategy.listen(async message => {
      deliveries.push(message);
      if (message.parseError) return { settlement: { kind: 'dead', reason: 'invalid-payload' } };
      if (message.payload.retry === true && message.deliveryAttempt === 1)
        return { settlement: { kind: 'retry', afterMs: 1100 } };
      if (message.payload.dead === true) return { settlement: { kind: 'dead', reason: 'attempts-exhausted' } };
      return { settlement: { kind: 'ack' } };
    });
    await strategy.emit(
      'orders.created',
      { id: 7 },
      { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' },
    );
    await waitFor(() => assert.equal(deliveries.length, 1));
    assert.deepEqual(deliveries[0], {
      pattern: 'orders.created',
      payload: { id: 7 },
      headers: {},
      correlationId: undefined,
      replyTo: undefined,
      deliveryAttempt: 1,
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    });
    const emptySource = () =>
      waitFor(async () => {
        const { Attributes } = await observer.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
          }),
        );
        assert.equal(Attributes.ApproximateNumberOfMessages, '0');
        assert.equal(Attributes.ApproximateNumberOfMessagesNotVisible, '0');
      });
    await emptySource();
    const attributes = { 'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' } };
    const retryBody = '{"version":1,"payload":{"retry":true},"headers":{"request-id":"fixed"}}';
    await observer.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: retryBody, MessageAttributes: attributes }),
    );
    await waitFor(() => assert.equal(deliveries.filter(message => message.payload?.retry).length, 1));
    const hidden = await observer.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 0 }));
    assert.deepEqual(hidden.Messages ?? [], [], 'retry remains invisible before its delay');
    await waitFor(() => assert.equal(deliveries.filter(message => message.payload?.retry).length, 2), 6000);
    assert.deepEqual(
      deliveries.filter(message => message.payload?.retry).map(message => [message.deliveryAttempt, message.headers]),
      [
        [1, { 'request-id': 'fixed' }],
        [2, { 'request-id': 'fixed' }],
      ],
    );
    await emptySource();
    for (const [body, reason] of [
      ['{"version":1,"payload":{"dead":true},"headers":{}}', 'attempts-exhausted'],
      ['{malformed', 'invalid-payload'],
    ]) {
      await observer.send(
        new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body, MessageAttributes: attributes }),
      );
      let deadMessage;
      await waitFor(async () => {
        const result = await observer.send(
          new ReceiveMessageCommand({
            QueueUrl: deadLetterQueueUrl,
            WaitTimeSeconds: 0,
            MessageAttributeNames: ['All'],
          }),
        );
        assert.equal(result.Messages?.length, 1);
        [deadMessage] = result.Messages;
      });
      assert.equal(deadMessage.Body, body);
      assert.deepEqual(deadMessage.MessageAttributes, {
        ...attributes,
        'zmdb-dead-reason': { DataType: 'String', StringValue: reason },
      });
      await emptySource();
    }
    await strategy.close(500);
    await observer.send(new ListQueuesCommand({}));
    await client.send(new ListQueuesCommand({}));
    const restarted = createSqsStrategy(options(client, queueUrl, deadLetterQueueUrl, error => errors.push(error)));
    strategies.push(restarted);
    let afterRestart;
    await restarted.listen(async message => {
      afterRestart = message.payload;
      return { settlement: { kind: 'ack' } };
    });
    await restarted.emit('orders.created', { restarted: true });
    await waitFor(() => assert.deepEqual(afterRestart, { restarted: true }));
    await emptySource();
    await restarted.close(500);
    assert.deepEqual(errors, []);
    return { emitted: true, redelivered: true, deadLetters: 2, restarted: true, callerClientUsable: true };
  } finally {
    const closed = await Promise.allSettled(strategies.map(strategy => strategy.close(500)));
    const deleted = await Promise.allSettled(
      queueUrls.map(QueueUrl => observer.send(new DeleteQueueCommand({ QueueUrl }))),
    );
    client.destroy();
    observer.destroy();
    const failures = [...closed, ...deleted].filter(result => result.status === 'rejected');
    assert.deepEqual(failures, [], 'SQS fixture left a strategy or queue');
  }
}
