// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  decodeDelivery,
  encodeDelivery,
  reportTransportError,
  TransportUnsupportedError,
  withinGrace,
  type RawMessage,
  type TransportErrorSink,
  type TransportStrategy,
} from '@zmdb/app/messaging';

export interface SqsStrategyOptions {
  readonly client: SQSClient;
  readonly queueUrl: string;
  readonly deadLetterQueueUrl: string;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly maxInFlight: number;
  readonly requestTimeoutMs: number;
  readonly pollRetryMs: number;
  readonly onError: TransportErrorSink;
  readonly name?: string;
}

const MAX_TIMER = 2147483647;

function integer(value: number, minimum: number, maximum: number, description: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `@zmdb/transport/sqs: SQS ${description} must be an integer from ${minimum} through ${maximum}`,
    );
}

function queue(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError('@zmdb/transport/sqs: SQS queue URL must be an HTTP(S) standard queue', { cause });
  }
  if (!['http:', 'https:'].includes(url.protocol) || decodeURIComponent(url.pathname).endsWith('.fifo'))
    throw new TypeError('@zmdb/transport/sqs: SQS queue URL must be an HTTP(S) standard queue');
  return url.href;
}

export function createSqsStrategy(options: SqsStrategyOptions): TransportStrategy {
  const {
    client,
    waitTimeSeconds,
    visibilityTimeoutSeconds,
    maxInFlight,
    requestTimeoutMs,
    pollRetryMs,
    onError,
    name = 'sqs',
  } = options;
  const queueUrl = queue(options.queueUrl);
  const deadLetterQueueUrl = queue(options.deadLetterQueueUrl);
  if (queueUrl === deadLetterQueueUrl)
    throw new TypeError('@zmdb/transport/sqs: SQS source and dead-letter queues must differ');
  if (!client || typeof client.send !== 'function' || typeof onError !== 'function')
    throw new TypeError('@zmdb/transport/sqs: SQS requires a caller-owned SDK client and onError callback');
  if (typeof name !== 'string' || name.trim().length === 0)
    throw new TypeError('@zmdb/transport/sqs: SQS name cannot be empty');
  integer(waitTimeSeconds, 1, 20, 'waitTimeSeconds');
  integer(visibilityTimeoutSeconds, 1, 43200, 'visibilityTimeoutSeconds');
  integer(maxInFlight, 1, Number.MAX_SAFE_INTEGER, 'maxInFlight');
  integer(requestTimeoutMs, waitTimeSeconds * 1000 + 1, MAX_TIMER, 'requestTimeoutMs');
  integer(pollRetryMs, 1, 60000, 'pollRetryMs');

  const intake = new AbortController();
  const stopped = Promise.withResolvers<void>();
  const requests = new Set<AbortController>();
  const handlers = new Set<Promise<void>>();
  const emissions = new Set<Promise<void>>();
  let started = false;
  let listening = false;
  let closed = false;
  let expired = false;
  let startup: Promise<void> | undefined;
  let polling: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  async function request<T>(action: (signal: AbortSignal) => Promise<T>, receiving = false): Promise<T> {
    const controller = new AbortController();
    requests.add(controller);
    const timer = setTimeout(
      () => controller.abort(new Error('@zmdb/transport/sqs: SQS request timed out')),
      requestTimeoutMs,
    );
    const signal = receiving ? AbortSignal.any([controller.signal, intake.signal]) : controller.signal;
    try {
      if (expired) throw new Error('@zmdb/transport/sqs: SQS drain grace expired');
      return await action(signal);
    } finally {
      clearTimeout(timer);
      requests.delete(controller);
    }
  }

  async function pause(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        stopped.promise,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, pollRetryMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handle(message: Message, dispatch: Parameters<TransportStrategy['listen']>[0]): Promise<void> {
    const receipt = message.ReceiptHandle;
    if (!receipt) throw new Error('@zmdb/transport/sqs: SQS delivery has no current receipt');
    const attribute = message.MessageAttributes?.['zmdb-pattern'];
    const pattern = attribute?.StringValue ?? '';
    const count = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    let delivery: RawMessage = decodeDelivery(pattern, message.Body ?? '', count);
    if (attribute?.DataType !== 'String' || pattern.trim().length === 0 || !Number.isSafeInteger(count) || count < 1)
      delivery = { ...delivery, parseError: new TypeError('@zmdb/transport/sqs: invalid SQS delivery framing') };
    const outcome = await dispatch(delivery);
    if (expired) return;
    const settlement = outcome.settlement;
    if (settlement.kind === 'retry') {
      const seconds = Math.ceil(settlement.afterMs / 1000);
      if (!Number.isFinite(settlement.afterMs) || settlement.afterMs <= 0 || seconds > 43200)
        throw new RangeError('@zmdb/transport/sqs: SQS retry delay must round to 1 through 43200 seconds');
      await request(signal =>
        client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: receipt,
            VisibilityTimeout: seconds,
          }),
          { abortSignal: signal },
        ),
      );
      return;
    }
    if (settlement.kind === 'dead') {
      await request(signal =>
        client.send(
          new SendMessageCommand({
            QueueUrl: deadLetterQueueUrl,
            MessageBody: message.Body ?? '',
            MessageAttributes: {
              ...message.MessageAttributes,
              'zmdb-dead-reason': { DataType: 'String', StringValue: settlement.reason },
            },
          }),
          { abortSignal: signal },
        ),
      );
    }
    if (expired) return;
    await request(signal =>
      client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt }), {
        abortSignal: signal,
      }),
    );
  }

  async function poll(dispatch: Parameters<TransportStrategy['listen']>[0]): Promise<void> {
    for (;;) {
      if (closed) break;
      if (handlers.size >= maxInFlight) {
        await Promise.race([...handlers, stopped.promise]);
        continue;
      }
      try {
        const result = await request(
          signal =>
            client.send(
              new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: Math.min(10, maxInFlight - handlers.size),
                WaitTimeSeconds: waitTimeSeconds,
                VisibilityTimeout: visibilityTimeoutSeconds,
                MessageSystemAttributeNames: ['ApproximateReceiveCount'],
                MessageAttributeNames: ['All'],
              }),
              { abortSignal: signal },
            ),
          true,
        );
        for (const message of result.Messages ?? []) {
          if (closed || handlers.size >= maxInFlight) break;
          const task = Promise.resolve()
            .then(() => handle(message, dispatch))
            .catch(error => {
              if (!expired) reportTransportError(onError, error);
            })
            .finally(() => handlers.delete(task));
          handlers.add(task);
        }
      } catch (error) {
        if (closed) break;
        reportTransportError(onError, error);
        await pause();
      }
    }
  }

  return {
    name,
    capabilities: { redelivery: true, deadLetter: true, requestResponse: false },
    async listen(dispatch): Promise<void> {
      if (closed) throw new Error('@zmdb/transport/sqs: SQS strategy is closed');
      if (started) throw new Error('@zmdb/transport/sqs: SQS strategy already started listening');
      started = true;
      startup = (async () => {
        for (const QueueUrl of [queueUrl, deadLetterQueueUrl]) {
          const result = await request(
            signal =>
              client.send(
                new GetQueueAttributesCommand({
                  QueueUrl,
                  AttributeNames: ['FifoQueue'],
                }),
                { abortSignal: signal },
              ),
            true,
          );
          if (result.Attributes?.FifoQueue === 'true')
            throw new TypeError('@zmdb/transport/sqs: SQS requires standard queues, not FIFO');
        }
        if (closed) throw new Error('@zmdb/transport/sqs: SQS strategy is closed');
        listening = true;
        polling = poll(dispatch);
      })();
      await startup;
    },
    async send() {
      throw new TransportUnsupportedError(name);
    },
    async emit(pattern, payload, carrier): Promise<void> {
      if (closed) throw new Error('@zmdb/transport/sqs: SQS strategy is closed');
      if (!listening) throw new Error('@zmdb/transport/sqs: SQS strategy is not listening');
      if (typeof pattern !== 'string' || pattern.trim().length === 0)
        throw new TypeError('@zmdb/transport/sqs: SQS pattern cannot be empty');
      const MessageBody = encodeDelivery(payload, carrier);
      const task = request(signal =>
        client.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody,
            MessageAttributes: { 'zmdb-pattern': { DataType: 'String', StringValue: pattern } },
          }),
          { abortSignal: signal },
        ),
      ).then(() => undefined);
      emissions.add(task);
      try {
        await task;
      } finally {
        emissions.delete(task);
      }
    },
    async close(graceMs): Promise<void> {
      integer(graceMs, 0, MAX_TIMER, 'close grace');
      if (closing) return closing;
      closed = true;
      listening = false;
      intake.abort(new Error('@zmdb/transport/sqs: SQS intake closed'));
      stopped.resolve();
      closing = (async () => {
        const settled = Promise.all([
          startup?.catch(() => undefined),
          polling,
          ...handlers,
          ...[...emissions].map(task => task.catch(() => undefined)),
        ]).then(() => undefined);
        if (await withinGrace(settled, graceMs)) return;
        expired = true;
        const error = new Error('@zmdb/transport/sqs: SQS drain grace expired');
        for (const controller of requests) controller.abort(error);
        throw error;
      })();
      return closing;
    },
  };
}
