// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { pathToFileURL } from 'node:url';

import { SQSClient } from '@aws-sdk/client-sqs';
import { TransportUnsupportedError, encodeDelivery } from '@zmdb/app/messaging';
import type { DispatchOutcome, RawMessage, TransportStrategy } from '@zmdb/app/messaging';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Options {
  readonly client: SQSClient;
  readonly queueUrl: string;
  readonly deadLetterQueueUrl: string;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly maxInFlight: number;
  readonly requestTimeoutMs: number;
  readonly pollRetryMs: number;
  readonly onError: (error: unknown) => void;
  readonly name?: string;
}
interface Call {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly signal?: AbortSignal;
}
type Response = Record<string, unknown>;
type Action = (call: Call) => Promise<Response>;
const source = 'http://127.0.0.1:9324/000000000000/source';
const dead = 'http://127.0.0.1:9324/000000000000/dead';
const calls: Call[] = [];
const errors: unknown[] = [];
const pending: (() => void)[] = [];
const actions = new Map<string, Action[]>();
const active: TransportStrategy[] = [];
let client: SQSClient;
let destroy: ReturnType<typeof vi.spyOn>;

function deferred<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 1500, interval: 5 });
}

function receive(receipt = 'current-receipt', body = encodeDelivery({ id: 7 }, undefined), count = '1') {
  return {
    Messages: [
      {
        MessageId: 'same-message',
        ReceiptHandle: receipt,
        Body: body,
        Attributes: { ApproximateReceiveCount: count },
        MessageAttributes: { 'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' } },
      },
    ],
  };
}

async function factory(overrides: Partial<Options> = {}) {
  const module = (await import(pathToFileURL(`${import.meta.dirname}/index.ts`).href)) as {
    createSqsStrategy(options: Options): TransportStrategy;
  };
  expect(Object.keys(module)).toEqual(['createSqsStrategy']);
  const options: Options = {
    client,
    queueUrl: source,
    deadLetterQueueUrl: dead,
    waitTimeSeconds: 1,
    visibilityTimeoutSeconds: 30,
    maxInFlight: 2,
    requestTimeoutMs: 1500,
    pollRetryMs: 20,
    onError: error => errors.push(error),
    ...overrides,
  };
  const strategy = module.createSqsStrategy(options);
  active.push(strategy);
  return strategy;
}

beforeEach(() => {
  calls.length = 0;
  errors.length = 0;
  actions.clear();
  active.length = 0;
  pending.length = 0;
  client = new SQSClient({
    endpoint: 'http://127.0.0.1:1',
    region: 'us-east-1',
    maxAttempts: 1,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  destroy = vi.spyOn(client, 'destroy');
  Object.defineProperty(client, 'send', {
    value: vi.fn(
      async (
        command: { constructor: { name: string }; input: Record<string, unknown> },
        options?: { abortSignal?: AbortSignal },
      ) => {
        const call: Call = {
          name: command.constructor.name,
          input: command.input,
          ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
        };
        calls.push(call);
        const action = actions.get(call.name)?.shift();
        if (action) return action(call);
        if (call.name === 'GetQueueAttributesCommand') return { Attributes: { FifoQueue: 'false' } };
        if (call.name === 'ReceiveMessageCommand')
          return new Promise<Response>((resolve, reject) => {
            if (call.signal?.aborted) {
              reject(call.signal.reason);
              return;
            }
            call.signal?.addEventListener('abort', () => reject(call.signal?.reason), { once: true });
            pending.push(() => resolve({}));
          });
        return { MessageId: 'confirmed-message' };
      },
    ),
  });
});

afterEach(async () => {
  for (const release of pending) release();
  await Promise.allSettled(active.map(strategy => strategy.close(20)));
  client.destroy();
});

describe('selected SQS transport', () => {
  it('validates explicit standard queues and bounded settings before broker work', async () => {
    await factory();
    for (const invalid of [
      { queueUrl: '' },
      { queueUrl: 'file:///queue' },
      { queueUrl: `${source}.fifo` },
      { client: null as unknown as SQSClient },
      { onError: undefined as unknown as Options['onError'] },
      { name: '' },
      { deadLetterQueueUrl: source },
      { deadLetterQueueUrl: `${dead}.fifo` },
      { waitTimeSeconds: 0 },
      { waitTimeSeconds: 21 },
      { waitTimeSeconds: 1.5 },
      { visibilityTimeoutSeconds: 0 },
      { visibilityTimeoutSeconds: 43201 },
      { visibilityTimeoutSeconds: 1.5 },
      { maxInFlight: 0 },
      { maxInFlight: 1.5 },
      { maxInFlight: Number.POSITIVE_INFINITY },
      { requestTimeoutMs: 1000 },
      { requestTimeoutMs: Number.POSITIVE_INFINITY },
      { requestTimeoutMs: 1500.5 },
      { requestTimeoutMs: 2147483648 },
      { pollRetryMs: 0 },
      { pollRetryMs: 60001 },
    ])
      await expect(factory(invalid)).rejects.toThrow(/SQS|sqs/);
    expect(calls).toEqual([]);
  });

  it('exposes the app SPI and rejects requests, duplicate starts and closed use', async () => {
    const strategy = await factory();
    expect(strategy.name).toBe('sqs');
    expect(strategy.capabilities).toEqual({ redelivery: true, deadLetter: true, requestResponse: false });
    await expect(
      strategy.send({
        pattern: 'request',
        payload: {},
        correlationId: 'id',
        timeoutMs: 20,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(TransportUnsupportedError);
    await expect(strategy.emit('orders.created', {})).rejects.toThrow(/listening/);
    expect(calls).toEqual([]);
    await strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
    expect(calls.filter(call => call.name === 'GetQueueAttributesCommand').map(call => call.input)).toEqual([
      { QueueUrl: source, AttributeNames: ['FifoQueue'] },
      { QueueUrl: dead, AttributeNames: ['FifoQueue'] },
    ]);
    await expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toThrow(/listening|started/);
    for (const invalidGrace of [-1, Number.NaN, 0.5, 2147483648])
      await expect(strategy.close(invalidGrace)).rejects.toThrow(/grace/i);
    await strategy.close(100);
    await strategy.close(100);
    expect(destroy).not.toHaveBeenCalled();
    await expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toThrow(/closed/);
    await expect(strategy.emit('orders.created', {})).rejects.toThrow(/closed/);
  });

  it('sends the canonical envelope and explicit pattern through the supplied SDK client', async () => {
    const strategy = await factory();
    await strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
    await strategy.emit('orders.created', { id: 7 }, { traceparent: '00-trace-parent-01', tracestate: 'vendor=value' });
    expect(calls.find(call => call.name === 'SendMessageCommand')?.input).toEqual({
      QueueUrl: source,
      MessageBody: JSON.stringify({
        version: 1,
        payload: { id: 7 },
        headers: {},
        traceparent: '00-trace-parent-01',
        tracestate: 'vendor=value',
      }),
      MessageAttributes: { 'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' } },
    });
    await expect(strategy.emit('', {})).rejects.toThrow(/pattern/);
    await expect(strategy.emit('orders.created', undefined)).rejects.toThrow(/undefined/);
    const fault = new Error('send-wire-failure');
    actions.set('SendMessageCommand', [
      async () => {
        throw fault;
      },
    ]);
    await expect(strategy.emit('orders.created', {})).rejects.toBe(fault);
  });

  it('decodes delivery attempts and acknowledges each current receipt only after dispatch', async () => {
    actions.set('ReceiveMessageCommand', [
      async () => receive('receipt-first'),
      async () => receive('receipt-second', encodeDelivery({ id: 7 }, undefined), '2'),
    ]);
    const delivered: RawMessage[] = [];
    const hold = deferred<DispatchOutcome>();
    const strategy = await factory({ maxInFlight: 1 });
    await strategy.listen(async message => {
      delivered.push(message);
      return delivered.length === 1 ? hold.promise : { settlement: { kind: 'ack' } };
    });
    await until(() => delivered.length === 1);
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
    expect(calls.filter(call => call.name === 'ReceiveMessageCommand')).toHaveLength(1);
    hold.resolve({ settlement: { kind: 'ack' } });
    await until(() => calls.filter(call => call.name === 'DeleteMessageCommand').length === 2);
    expect(delivered.map(message => [message.pattern, message.payload, message.deliveryAttempt])).toEqual([
      ['orders.created', { id: 7 }, 1],
      ['orders.created', { id: 7 }, 2],
    ]);
    expect(calls.filter(call => call.name === 'DeleteMessageCommand').map(call => call.input)).toEqual([
      { QueueUrl: source, ReceiptHandle: 'receipt-first' },
      { QueueUrl: source, ReceiptHandle: 'receipt-second' },
    ]);
    expect(calls.find(call => call.name === 'ReceiveMessageCommand')?.input).toEqual({
      QueueUrl: source,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 30,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      MessageAttributeNames: ['All'],
    });
  });

  it('retries with rounded-up visibility and never acknowledges that retry', async () => {
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    const strategy = await factory();
    await strategy.listen(async () => ({ settlement: { kind: 'retry', afterMs: 1501 } }));
    await until(() => calls.some(call => call.name === 'ChangeMessageVisibilityCommand'));
    expect(calls.find(call => call.name === 'ChangeMessageVisibilityCommand')?.input).toEqual({
      QueueUrl: source,
      ReceiptHandle: 'current-receipt',
      VisibilityTimeout: 2,
    });
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
  });

  it('confirms the dead-letter send before deleting and leaves failed handoffs unacknowledged', async () => {
    const confirmed = deferred<Response>();
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    actions.set('SendMessageCommand', [() => confirmed.promise]);
    const strategy = await factory();
    await strategy.listen(async () => ({ settlement: { kind: 'dead', reason: 'invalid-payload' } }));
    await until(() => calls.some(call => call.name === 'SendMessageCommand'));
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
    expect(calls.find(call => call.name === 'SendMessageCommand')?.input).toEqual({
      QueueUrl: dead,
      MessageBody: encodeDelivery({ id: 7 }, undefined),
      MessageAttributes: {
        'zmdb-pattern': { DataType: 'String', StringValue: 'orders.created' },
        'zmdb-dead-reason': { DataType: 'String', StringValue: 'invalid-payload' },
      },
    });
    const failure = new Error('destination-unavailable');
    confirmed.reject(failure);
    await until(() => errors.includes(failure));
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
  });

  it('preserves malformed framing for the dispatcher and dead-letter destination', async () => {
    actions.set('ReceiveMessageCommand', [async () => receive('bad-receipt', '{broken')]);
    const observed: RawMessage[] = [];
    const strategy = await factory();
    await strategy.listen(async message => {
      observed.push(message);
      return { settlement: { kind: 'dead', reason: 'invalid-payload' } };
    });
    await until(() => calls.some(call => call.name === 'DeleteMessageCommand'));
    expect(observed[0]?.parseError).toBeInstanceOf(Error);
    expect(observed[0]?.payload).toBe('{broken');
    expect(calls.find(call => call.name === 'SendMessageCommand')?.input['MessageBody']).toBe('{broken');
    expect(
      calls.filter(call => ['SendMessageCommand', 'DeleteMessageCommand'].includes(call.name)).map(call => call.name),
    ).toEqual(['SendMessageCommand', 'DeleteMessageCommand']);
  });

  it('reports receive, dispatch and settlement failures without a false acknowledgement', async () => {
    const receiveFailure = new Error('receive-wire-failure');
    const dispatchFailure = new Error('dispatch-failure');
    actions.set('ReceiveMessageCommand', [
      async () => {
        throw receiveFailure;
      },
      async () => receive(),
    ]);
    const strategy = await factory();
    await strategy.listen(async () => {
      throw dispatchFailure;
    });
    await until(() => errors.length === 2);
    expect(errors).toEqual([receiveFailure, dispatchFailure]);
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
  });

  it('aborts pending polling, drains accepted work and never destroys the caller client', async () => {
    const strategy = await factory();
    await strategy.listen(async () => ({ settlement: { kind: 'ack' } }));
    await until(() => calls.some(call => call.name === 'ReceiveMessageCommand'));
    const poll = calls.find(call => call.name === 'ReceiveMessageCommand');
    await strategy.close(100);
    expect(poll?.signal?.aborted).toBe(true);
    expect(errors).toEqual([]);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('bounds close while a handler is pending and prevents settlement after timeout', async () => {
    const handler = deferred<DispatchOutcome>();
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    let entered = false;
    const strategy = await factory();
    await strategy.listen(() => {
      entered = true;
      return handler.promise;
    });
    await until(() => entered);
    const start = performance.now();
    await expect(strategy.close(20)).rejects.toThrow(/drain|grace/);
    expect(performance.now() - start).toBeLessThan(500);
    handler.resolve({ settlement: { kind: 'ack' } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('keeps startup faults and caller ownership observable', async () => {
    const failure = new Error('queue-access-denied');
    actions.set('GetQueueAttributesCommand', [
      async () => {
        throw failure;
      },
    ]);
    const strategy = await factory();
    await expect(strategy.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toBe(failure);
    expect(calls.filter(call => call.name === 'ReceiveMessageCommand')).toEqual([]);
    await strategy.close(50);
    expect(destroy).not.toHaveBeenCalled();
    actions.set('GetQueueAttributesCommand', [async () => ({ Attributes: { FifoQueue: 'true' } })]);
    const fifo = await factory();
    await expect(fifo.listen(async () => ({ settlement: { kind: 'ack' } }))).rejects.toThrow(/FIFO|standard/);
    expect(calls.filter(call => call.name === 'ReceiveMessageCommand')).toEqual([]);
  });

  it('waits for accepted dispatch and acknowledgement during graceful close', async () => {
    const handler = deferred<DispatchOutcome>();
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    let entered = false,
      closed = false;
    const strategy = await factory();
    await strategy.listen(() => {
      entered = true;
      return handler.promise;
    });
    await until(() => entered);
    const closing = strategy.close(500).then(() => {
      closed = true;
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(false);
    handler.resolve({ settlement: { kind: 'ack' } });
    await closing;
    expect(calls.filter(call => call.name === 'DeleteMessageCommand').map(call => call.input)).toEqual([
      { QueueUrl: source, ReceiptHandle: 'current-receipt' },
    ]);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('reports a failed delete and refuses invalid retry delays without settling', async () => {
    const failure = new Error('delete-wire-failure');
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    actions.set('DeleteMessageCommand', [
      async () => {
        throw failure;
      },
    ]);
    const first = await factory();
    await first.listen(async () => ({ settlement: { kind: 'ack' } }));
    await until(() => errors.includes(failure));
    await first.close(100);
    calls.length = 0;
    errors.length = 0;
    actions.set('ReceiveMessageCommand', [async () => receive()]);
    const second = await factory();
    await second.listen(async () => ({ settlement: { kind: 'retry', afterMs: -1 } }));
    await until(() => errors.length === 1);
    expect(String(errors[0])).toMatch(/retry|delay/);
    expect(
      calls.filter(call => ['DeleteMessageCommand', 'ChangeMessageVisibilityCommand'].includes(call.name)),
    ).toEqual([]);
  });

  it('rejects deliveries without receipts and ignores error-sink failures', async () => {
    actions.set('ReceiveMessageCommand', [async () => ({ Messages: [{ MessageId: 'bad', Body: '{}' }] })]);
    let reported = false;
    const dispatch = vi.fn(async (): Promise<DispatchOutcome> => ({ settlement: { kind: 'ack' } }));
    const strategy = await factory({
      onError: error => {
        reported = true;
        expect(String(error)).toMatch(/receipt/i);
        throw new Error('sink-failure');
      },
    });
    await strategy.listen(dispatch);
    await until(() => reported);
    expect(dispatch).not.toHaveBeenCalled();
    expect(calls.filter(call => call.name === 'DeleteMessageCommand')).toEqual([]);
    await strategy.close(100);
  });
});
