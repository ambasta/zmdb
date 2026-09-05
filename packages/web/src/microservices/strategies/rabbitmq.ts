import {
  abortError,
  decodeDelivery,
  decodeReply,
  encodeDelivery,
  encodeReply,
  InFlight,
  MessageTimeoutError,
  reportTransportError,
  withinGrace,
  type MessageReply,
  type TransportErrorSink,
  type TransportStrategy,
} from '@zmdb/app/messaging';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Options,
  type SocketOptions,
} from 'amqplib';

export interface RabbitMqDeadLetterOptions {
  readonly exchange: string;
  readonly queue: string;
  /** Topic binding on the dead-letter exchange. Defaults to `#`. */
  readonly binding?: string;
}

export interface RabbitMqRetryOptions {
  readonly exchange?: string;
  readonly queue?: string;
}

export interface RabbitMqStrategyOptions {
  readonly bindings: readonly string[];
  readonly connection: string;
  readonly deadLetter: RabbitMqDeadLetterOptions;
  readonly durable?: boolean;
  readonly exchange: string;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  /** Consumer prefetch is RabbitMQ's backpressure control and is required. */
  readonly prefetch: number;
  readonly queue: string;
  readonly retry?: RabbitMqRetryOptions;
  readonly socketOptions?: SocketOptions;
}

interface PendingReply {
  reject(error: unknown): void;
  resolve(reply: MessageReply): void;
}

function requiredName(value: string, description: string): string {
  if (value.length === 0) {
    throw new RangeError(`@zmdb/web: RabbitMQ ${description} cannot be empty`);
  }
  return value;
}

function positiveInteger(value: number, description: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`@zmdb/web: RabbitMQ ${description} must be a positive integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deliveryAttempt(message: ConsumeMessage): number {
  const rawHeaders: unknown = message.properties.headers;
  let deadLetters = 0;
  if (isRecord(rawHeaders)) {
    const deaths = rawHeaders['x-death'];
    if (Array.isArray(deaths)) {
      for (const death of deaths) {
        if (!isRecord(death)) {
          continue;
        }
        const count = death.count;
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          deadLetters += Math.floor(count);
        }
      }
    }
  }
  return Math.max(deadLetters + 1, message.fields.redelivered ? 2 : 1);
}

function optionalProperty(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Parameters<ConfirmChannel['publish']>[2],
  properties: Options.Publish,
): Promise<void> {
  channel.publish(exchange, routingKey, content, properties);
  await channel.waitForConfirms();
}

function amqpBytes(value: string): Parameters<ConfirmChannel['publish']>[2] {
  // amqplib checks Buffer.isBuffer at runtime and rejects an ordinary
  // Uint8Array, so the Node global is the narrow broker-client boundary.
  return globalThis.Buffer.from(value);
}

function rejectPending(pending: Map<string, PendingReply>, error: unknown): void {
  for (const waiter of pending.values()) {
    waiter.reject(error);
  }
  pending.clear();
}

/**
 * RabbitMQ topic-exchange strategy with bounded prefetch, publisher-confirmed
 * delayed retries and an owned dead-letter queue.
 *
 * A retry is copied to a TTL retry queue and confirmed before the original is
 * acknowledged. `nack(requeue: true)` is intentionally absent: it would put a
 * deterministic failure straight back at the queue head.
 */
export function createRabbitMqStrategy(options: RabbitMqStrategyOptions): TransportStrategy {
  const exchange = requiredName(options.exchange, 'exchange');
  const queue = requiredName(options.queue, 'queue');
  const bindings = options.bindings.map(binding => requiredName(binding, 'binding'));
  if (bindings.length === 0) {
    throw new RangeError('@zmdb/web: RabbitMQ requires at least one binding');
  }
  const deadLetterExchange = requiredName(options.deadLetter.exchange, 'dead-letter exchange');
  const deadLetterQueue = requiredName(options.deadLetter.queue, 'dead-letter queue');
  const deadLetterBinding = requiredName(options.deadLetter.binding ?? '#', 'dead-letter binding');
  const retryExchange = requiredName(options.retry?.exchange ?? `${exchange}.retry`, 'retry exchange');
  const retryQueue = requiredName(options.retry?.queue ?? `${queue}.retry`, 'retry queue');
  const prefetch = positiveInteger(options.prefetch, 'prefetch');
  const durable = options.durable ?? true;
  const name = options.name ?? 'rabbitmq';
  const inFlight = new InFlight(options.onError);
  const pending = new Map<string, PendingReply>();

  let model: ChannelModel | undefined;
  let consumerChannel: Channel | undefined;
  let publisherChannel: ConfirmChannel | undefined;
  let consumerTag: string | undefined;
  let replyConsumerTag: string | undefined;
  let replyQueue: string | undefined;
  let started = false;
  let closed = false;

  return {
    name,
    capabilities: { redelivery: true, deadLetter: true, requestResponse: true },

    async listen(dispatch): Promise<void> {
      if (started) {
        throw new Error('@zmdb/web: RabbitMQ strategy is already listening');
      }
      if (closed) {
        throw new Error('@zmdb/web: RabbitMQ strategy is closed');
      }
      started = true;

      const nextModel =
        options.socketOptions === undefined
          ? await connect(options.connection)
          : await connect(options.connection, options.socketOptions);
      nextModel.on('error', error => reportTransportError(options.onError, error));
      const nextConsumerChannel = await nextModel.createChannel();
      const nextPublisherChannel = await nextModel.createConfirmChannel();
      nextConsumerChannel.on('error', error => reportTransportError(options.onError, error));
      nextPublisherChannel.on('error', error => reportTransportError(options.onError, error));
      try {
        await nextConsumerChannel.assertExchange(exchange, 'topic', { durable });
        await nextConsumerChannel.assertExchange(retryExchange, 'topic', { durable });
        await nextConsumerChannel.assertExchange(deadLetterExchange, 'topic', { durable });
        await nextConsumerChannel.assertQueue(queue, {
          durable,
          deadLetterExchange,
        });
        for (const binding of bindings) {
          await nextConsumerChannel.bindQueue(queue, exchange, binding);
        }
        await nextConsumerChannel.assertQueue(retryQueue, {
          durable,
          deadLetterExchange: exchange,
        });
        await nextConsumerChannel.bindQueue(retryQueue, retryExchange, '#');
        await nextConsumerChannel.assertQueue(deadLetterQueue, { durable });
        await nextConsumerChannel.bindQueue(deadLetterQueue, deadLetterExchange, deadLetterBinding);
        await nextConsumerChannel.prefetch(prefetch);

        const assertedReplyQueue = await nextConsumerChannel.assertQueue('', {
          autoDelete: true,
          durable: false,
          exclusive: true,
        });
        const replyConsumer = await nextConsumerChannel.consume(
          assertedReplyQueue.queue,
          message => {
            if (message === null) {
              return;
            }
            const correlationId = optionalProperty(message.properties.correlationId);
            if (correlationId === undefined) {
              reportTransportError(options.onError, new TypeError('@zmdb/web: RabbitMQ reply has no correlation id'));
              return;
            }
            const waiter = pending.get(correlationId);
            if (waiter === undefined) {
              return;
            }
            try {
              waiter.resolve(decodeReply(message.content.toString('utf8')));
            } catch (error) {
              waiter.reject(error);
            }
          },
          { noAck: true },
        );

        nextPublisherChannel.on('return', message => {
          const correlationId = optionalProperty(message.properties.correlationId);
          if (correlationId !== undefined) {
            pending
              .get(correlationId)
              ?.reject(new Error(`@zmdb/web: RabbitMQ request "${message.fields.routingKey}" was not routed`));
          }
        });

        const consumer = await nextConsumerChannel.consume(
          queue,
          message => {
            if (message === null) {
              return;
            }
            void inFlight.run(async () => {
              const correlationId = optionalProperty(message.properties.correlationId);
              const messageReplyTo = optionalProperty(message.properties.replyTo);
              const delivery = decodeDelivery(
                message.fields.routingKey,
                message.content.toString('utf8'),
                deliveryAttempt(message),
                {
                  ...(correlationId === undefined ? {} : { correlationId }),
                  ...(messageReplyTo === undefined ? {} : { replyTo: messageReplyTo }),
                },
              );
              const outcome = await dispatch(delivery);
              if (outcome.reply !== undefined && messageReplyTo !== undefined) {
                await publishConfirmed(
                  nextPublisherChannel,
                  '',
                  messageReplyTo,
                  amqpBytes(encodeReply(outcome.reply)),
                  {
                    contentType: 'application/json',
                    correlationId: outcome.reply.correlationId,
                  },
                );
              }

              if (outcome.settlement.kind === 'ack') {
                nextConsumerChannel.ack(message);
                return;
              }
              if (outcome.settlement.kind === 'retry') {
                await publishConfirmed(
                  nextPublisherChannel,
                  retryExchange,
                  message.fields.routingKey,
                  message.content,
                  {
                    contentType: 'application/json',
                    expiration: outcome.settlement.afterMs,
                    persistent: true,
                    ...(correlationId === undefined ? {} : { correlationId }),
                    ...(messageReplyTo === undefined ? {} : { replyTo: messageReplyTo }),
                    ...(message.properties.headers === undefined ? {} : { headers: message.properties.headers }),
                  },
                );
                nextConsumerChannel.ack(message);
                return;
              }
              nextConsumerChannel.nack(message, false, false);
            });
          },
          { noAck: false },
        );
        model = nextModel;
        consumerChannel = nextConsumerChannel;
        publisherChannel = nextPublisherChannel;
        consumerTag = consumer.consumerTag;
        replyConsumerTag = replyConsumer.consumerTag;
        replyQueue = assertedReplyQueue.queue;
      } catch (error) {
        await nextConsumerChannel.close().catch(() => undefined);
        await nextPublisherChannel.close().catch(() => undefined);
        await nextModel.close().catch(() => undefined);
        throw error;
      }
    },

    async send(request): Promise<MessageReply> {
      const activePublisher = publisherChannel;
      const activeReplyQueue = replyQueue;
      if (activePublisher === undefined || activeReplyQueue === undefined) {
        throw new Error('@zmdb/web: RabbitMQ strategy is not listening');
      }
      if (request.signal.aborted) {
        throw abortError(request.signal);
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = (): void => undefined;
      const reply = new Promise<MessageReply>((resolve, reject) => {
        const finish = (): void => {
          pending.delete(request.correlationId);
          request.signal.removeEventListener('abort', abort);
          if (timer !== undefined) {
            clearTimeout(timer);
          }
        };
        abort = (): void => {
          finish();
          reject(abortError(request.signal));
        };
        pending.set(request.correlationId, {
          reject(error): void {
            finish();
            reject(error);
          },
          resolve(value): void {
            finish();
            resolve(value);
          },
        });
        request.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          pending
            .get(request.correlationId)
            ?.reject(new MessageTimeoutError(request.pattern, request.timeoutMs, request.correlationId));
        }, request.timeoutMs);
      });

      try {
        await publishConfirmed(
          activePublisher,
          exchange,
          request.pattern,
          amqpBytes(encodeDelivery(request.payload, request)),
          {
            contentType: 'application/json',
            correlationId: request.correlationId,
            mandatory: true,
            persistent: true,
            replyTo: activeReplyQueue,
          },
        );
      } catch (error) {
        pending.get(request.correlationId)?.reject(error);
      }
      return reply;
    },

    async emit(pattern, payload, carrier): Promise<void> {
      const activePublisher = publisherChannel;
      if (activePublisher === undefined) {
        throw new Error('@zmdb/web: RabbitMQ strategy is not listening');
      }
      await publishConfirmed(activePublisher, exchange, pattern, amqpBytes(encodeDelivery(payload, carrier)), {
        contentType: 'application/json',
        persistent: true,
      });
    },

    async close(graceMs): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      const activeModel = model;
      const activeConsumer = consumerChannel;
      const activePublisher = publisherChannel;
      const activeConsumerTag = consumerTag;
      const activeReplyConsumerTag = replyConsumerTag;
      model = undefined;
      consumerChannel = undefined;
      publisherChannel = undefined;
      consumerTag = undefined;
      replyConsumerTag = undefined;
      replyQueue = undefined;
      rejectPending(pending, new Error('@zmdb/web: RabbitMQ strategy closed before receiving a reply'));
      if (activeModel === undefined || activeConsumer === undefined || activePublisher === undefined) {
        return;
      }

      const graceful = (async (): Promise<void> => {
        if (activeConsumerTag !== undefined) {
          await activeConsumer.cancel(activeConsumerTag);
        }
        if (activeReplyConsumerTag !== undefined) {
          await activeConsumer.cancel(activeReplyConsumerTag);
        }
        inFlight.stop();
        await inFlight.settled();
        await activeConsumer.close();
        await activePublisher.close();
        await activeModel.close();
      })();
      if (!(await withinGrace(graceful, graceMs))) {
        await activeModel.close().catch(() => undefined);
        throw new Error(`@zmdb/web: RabbitMQ strategy did not drain within ${String(graceMs)}ms`);
      }
    },
  };
}
