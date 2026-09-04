import { createClient, type RedisClientOptions } from 'redis';

import { MessageTimeoutError, type MessageReply, type TransportStrategy } from '../index.js';
import { decodeDelivery, decodeReply, encodeDelivery, encodeReply } from './codec.js';
import { abortError, InFlight, reportTransportError, type TransportErrorSink, withinGrace } from './drain.js';

type RedisClient = ReturnType<typeof createClient>;

export interface RedisStrategyOptions {
  /** Exact pub/sub channels. Each delivered channel is dispatched as the concrete message pattern. */
  readonly channels?: readonly string[];
  /** Redis glob subscriptions. Concrete channels, never the glob, are dispatched. */
  readonly channelPatterns?: readonly string[];
  readonly connection?: RedisClientOptions;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  /** Unique prefix for this process's request/reply channels. */
  readonly replyPrefix?: string;
}

interface PendingReply {
  readonly channel: string;
  reject(error: unknown): void;
  resolve(reply: MessageReply): void;
}

function nonEmpty(values: readonly string[], description: string): readonly string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (value.length === 0) {
      throw new RangeError(`@zmdb/web: ${description} cannot be empty`);
    }
    if (unique.has(value)) {
      throw new Error(`@zmdb/web: duplicate ${description} "${value}"`);
    }
    unique.add(value);
  }
  return [...unique];
}

function rejectPending(pending: Map<string, PendingReply>, error: unknown): void {
  for (const waiter of pending.values()) {
    waiter.reject(error);
  }
  pending.clear();
}

/**
 * Redis Pub/Sub strategy.
 *
 * Pub/Sub is deliberately represented as lossy: there is no acknowledgement,
 * redelivery or dead-letter destination, and a publish with no connected
 * subscriber is gone. `createApp` therefore requires `onUndeliverable`.
 */
export function createRedisStrategy(options: RedisStrategyOptions): TransportStrategy {
  const channels = nonEmpty(options.channels ?? [], 'Redis channel');
  const channelPatterns = nonEmpty(options.channelPatterns ?? [], 'Redis channel pattern');
  const name = options.name ?? 'redis';
  const replyPrefix = options.replyPrefix ?? `zmdb.reply.${globalThis.crypto.randomUUID()}`;
  if (replyPrefix.length === 0) {
    throw new RangeError('@zmdb/web: Redis replyPrefix cannot be empty');
  }

  const inFlight = new InFlight(options.onError);
  const pending = new Map<string, PendingReply>();
  let publisher: RedisClient | undefined;
  let subscriber: RedisClient | undefined;
  let started = false;
  let closed = false;

  const handleReply = (message: string, channel: string): void => {
    let reply: MessageReply;
    try {
      reply = decodeReply(message);
    } catch (error) {
      reportTransportError(options.onError, error);
      return;
    }
    const waiter = pending.get(reply.correlationId);
    if (waiter === undefined || waiter.channel !== channel) {
      return;
    }
    waiter.resolve(reply);
  };

  return {
    name,
    capabilities: { redelivery: false, deadLetter: false, requestResponse: true },

    async listen(dispatch): Promise<void> {
      if (started) {
        throw new Error('@zmdb/web: Redis strategy is already listening');
      }
      if (closed) {
        throw new Error('@zmdb/web: Redis strategy is closed');
      }
      started = true;

      const nextPublisher = createClient(options.connection);
      const nextSubscriber = nextPublisher.duplicate();
      nextPublisher.on('error', error => reportTransportError(options.onError, error));
      nextSubscriber.on('error', error => reportTransportError(options.onError, error));
      try {
        await Promise.all([nextPublisher.connect(), nextSubscriber.connect()]);
        await nextSubscriber.pSubscribe(`${replyPrefix}:*`, handleReply);
        for (const channel of channels) {
          await nextSubscriber.subscribe(channel, (message, concreteChannel) => {
            void inFlight.run(async () => {
              const delivery = decodeDelivery(concreteChannel, message, 1);
              const outcome = await dispatch(delivery);
              if (outcome.reply !== undefined && delivery.replyTo !== undefined) {
                await nextPublisher.publish(delivery.replyTo, encodeReply(outcome.reply));
              }
            });
          });
        }
        for (const pattern of channelPatterns) {
          await nextSubscriber.pSubscribe(pattern, (message, concreteChannel) => {
            void inFlight.run(async () => {
              const delivery = decodeDelivery(concreteChannel, message, 1);
              const outcome = await dispatch(delivery);
              if (outcome.reply !== undefined && delivery.replyTo !== undefined) {
                await nextPublisher.publish(delivery.replyTo, encodeReply(outcome.reply));
              }
            });
          });
        }
      } catch (error) {
        nextSubscriber.destroy();
        nextPublisher.destroy();
        throw error;
      }
      publisher = nextPublisher;
      subscriber = nextSubscriber;
    },

    async send(request): Promise<MessageReply> {
      const activePublisher = publisher;
      if (activePublisher === undefined || subscriber === undefined) {
        throw new Error('@zmdb/web: Redis strategy is not listening');
      }
      if (request.signal.aborted) {
        throw abortError(request.signal);
      }

      const replyChannel = `${replyPrefix}:${request.correlationId}`;
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
          channel: replyChannel,
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
          const waiter = pending.get(request.correlationId);
          waiter?.reject(new MessageTimeoutError(request.pattern, request.timeoutMs, request.correlationId));
        }, request.timeoutMs);
      });

      try {
        await activePublisher.publish(
          request.pattern,
          encodeDelivery(request.payload, request, {
            correlationId: request.correlationId,
            replyTo: replyChannel,
          }),
        );
      } catch (error) {
        pending.get(request.correlationId)?.reject(error);
      }
      return reply;
    },

    async emit(pattern, payload, carrier): Promise<void> {
      const activePublisher = publisher;
      if (activePublisher === undefined || subscriber === undefined) {
        throw new Error('@zmdb/web: Redis strategy is not listening');
      }
      await activePublisher.publish(pattern, encodeDelivery(payload, carrier));
    },

    async close(graceMs): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      const activePublisher = publisher;
      const activeSubscriber = subscriber;
      publisher = undefined;
      subscriber = undefined;
      rejectPending(pending, new Error('@zmdb/web: Redis strategy closed before receiving a reply'));
      if (activePublisher === undefined || activeSubscriber === undefined) {
        return;
      }

      const graceful = (async (): Promise<void> => {
        for (const channel of channels) {
          await activeSubscriber.unsubscribe(channel);
        }
        for (const pattern of channelPatterns) {
          await activeSubscriber.pUnsubscribe(pattern);
        }
        await activeSubscriber.pUnsubscribe(`${replyPrefix}:*`);
        inFlight.stop();
        await inFlight.settled();
        await Promise.all([activeSubscriber.close(), activePublisher.close()]);
      })();
      if (!(await withinGrace(graceful, graceMs))) {
        activeSubscriber.destroy();
        activePublisher.destroy();
        throw new Error(`@zmdb/web: Redis strategy did not drain within ${String(graceMs)}ms`);
      }
    },
  };
}
