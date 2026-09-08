import assert from 'node:assert/strict';

import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

import { sdk, waitFor } from './broker.mjs';
import { options } from './runtime.mjs';

export async function exerciseWire(createSqsStrategy, endpoint) {
  const client = sdk(endpoint);
  const queueUrl = `${endpoint}/000000000000/source`;
  const dead = `${endpoint}/000000000000/dead`;
  const errors = [];
  const active = [];
  const admin = async (path, body) => {
    const response = await fetch(`${endpoint}/__admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(2000),
    });
    assert(response.ok, `WireMock ${path}: ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };
  const mapping = async (operation, response, extra = {}) =>
    admin('mappings', {
      request: {
        method: 'POST',
        urlPathPattern: '.*',
        headers: { 'X-Amz-Target': { equalTo: `AmazonSQS.${operation}` } },
      },
      response: { headers: { 'Content-Type': 'application/x-amz-json-1.0' }, ...response },
      ...extra,
    });
  const operations = async () =>
    (await admin('requests')).requests.toReversed().map(event => ({
      operation: event.request.headers['X-Amz-Target'] ?? event.request.headers['x-amz-target'],
      body: JSON.parse(event.request.body),
    }));
  try {
    await admin('reset', {});
    await mapping('GetQueueAttributes', { status: 200, jsonBody: { Attributes: { FifoQueue: 'false' } } });
    await mapping(
      'ReceiveMessage',
      {
        status: 200,
        jsonBody: {
          Messages: [
            {
              MessageId: 'wire-source',
              ReceiptHandle: 'wire-current-receipt',
              Body: '{"version":1,"payload":{"id":9},"headers":{}}',
              MD5OfBody: '6a0fcac823be606d99d604ec4d502c57',
              Attributes: { ApproximateReceiveCount: '1' },
              MessageAttributes: { 'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' } },
            },
          ],
        },
      },
      { priority: 1, scenarioName: 'one-delivery', requiredScenarioState: 'Started', newScenarioState: 'delivered' },
    );
    await mapping('ReceiveMessage', { status: 200, jsonBody: {}, fixedDelayMilliseconds: 10_000 }, { priority: 5 });
    await mapping('SendMessage', {
      status: 503,
      jsonBody: { __type: 'ServiceUnavailable', message: 'destination-wire-failure' },
    });
    await mapping('DeleteMessage', { status: 200, jsonBody: {} });
    assert.deepEqual(
      (await client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['FifoQueue'] })))
        .Attributes,
      { FifoQueue: 'false' },
    );
    const strategy = createSqsStrategy(options(client, queueUrl, dead, error => errors.push(error)));
    active.push(strategy);
    await strategy.listen(async () => ({ settlement: { kind: 'dead', reason: 'invalid-payload' } }));
    await waitFor(() => assert.equal(errors.length, 1));
    assert.match(String(errors[0]), /destination-wire-failure/);
    const recorded = await operations();
    assert.equal(recorded.filter(call => call.operation === 'AmazonSQS.SendMessage').length, 1);
    assert.equal(
      recorded.filter(call => call.operation === 'AmazonSQS.DeleteMessage').length,
      0,
      'failed destination send must never delete the current source receipt',
    );
    const send = recorded.find(call => call.operation === 'AmazonSQS.SendMessage');
    assert.deepEqual(send.body, {
      QueueUrl: dead,
      MessageBody: '{"version":1,"payload":{"id":9},"headers":{}}',
      MessageAttributes: {
        'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' },
        'zmdb-dead-reason': { DataType: 'String', StringValue: 'invalid-payload' },
      },
    });
    const start = performance.now();
    await strategy.close(200);
    assert(performance.now() - start < 1000, 'closing must abort the pending SDK long-poll');
    await client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['FifoQueue'] }));
    return { realSdkError: true, sourceDeleteAbsent: true, exactWireBody: true, pendingPollAborted: true };
  } finally {
    const closed = await Promise.allSettled(active.map(strategy => strategy.close(200)));
    client.destroy();
    assert(
      closed.every(result => result.status === 'fulfilled'),
      'wire fixture strategy cleanup failed',
    );
    await admin('reset', {});
  }
}
