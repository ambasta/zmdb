import {
  connect,
  createInbox,
  type NatsConnection,
  type NodeConnectionOptions,
  type Subscription,
} from '@nats-io/transport-node';
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

import { createNatsSubjectMatcher } from './matcher.js';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export interface NatsSubscription {
  /** NATS subject; `*` and a final `>` use native NATS token semantics. */
  readonly subject: string;
  /** Queue group for horizontally balanced delivery. */
  readonly queue?: string;
}

export interface NatsStrategyOptions {
  readonly connection?: NodeConnectionOptions;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  readonly subscriptions: readonly NatsSubscription[];
}

function validateSubscriptions(subscriptions: readonly NatsSubscription[]): readonly NatsSubscription[] {
  const seen = new Set<string>();
  return subscriptions.map(subscription => {
    if (subscription.subject.length === 0) {
      throw new RangeError('@zmdb/transport-nats: a NATS subscription subject cannot be empty');
    }
    if (subscription.queue !== undefined && subscription.queue.length === 0) {
      throw new RangeError('@zmdb/transport-nats: a NATS queue group cannot be empty');
    }
    const key = `${subscription.subject}\u0000${subscription.queue ?? ''}`;
    if (seen.has(key)) {
      throw new Error(`@zmdb/transport-nats: duplicate NATS subscription "${subscription.subject}"`);
    }
    seen.add(key);
    return { ...subscription };
  });
}

/**
 * Core NATS strategy.
 *
 * Core NATS is at-most-once: successful settlements need no acknowledgement,
 * while `retry` and `dead` cannot be honoured after delivery. Queue groups and
 * subject wildcards are native subscription features; wildcard membership is
 * also checked through a startup-built trie rather than a pattern scan.
 */
export function createNatsStrategy(options: NatsStrategyOptions): TransportStrategy {
  const subscriptions = validateSubscriptions(options.subscriptions);
  const matcher = createNatsSubjectMatcher(subscriptions.map(subscription => subscription.subject));
  const inFlight = new InFlight(options.onError);
  const name = options.name ?? 'nats';
  let connection: NatsConnection | undefined;
  let activeSubscriptions: Subscription[] = [];
  let started = false;
  let closed = false;

  return {
    name,
    capabilities: { redelivery: false, deadLetter: false, requestResponse: true },

    async listen(dispatch): Promise<void> {
      if (started) {
        throw new Error('@zmdb/transport-nats: NATS strategy is already listening');
      }
      if (closed) {
        throw new Error('@zmdb/transport-nats: NATS strategy is closed');
      }
      started = true;

      const nextConnection = await connect(options.connection);
      const nextSubscriptions: Subscription[] = [];
      try {
        for (const subscription of subscriptions) {
          const opened = nextConnection.subscribe(
            subscription.subject,
            subscription.queue === undefined
              ? {
                  callback(error, message): void {
                    if (error !== null) {
                      reportTransportError(options.onError, error);
                      return;
                    }
                    void inFlight.run(async () => {
                      if (!matcher.matches(message.subject)) {
                        throw new Error(
                          `@zmdb/transport-nats: NATS delivered unsubscribed subject "${message.subject}"`,
                        );
                      }
                      const delivery = decodeDelivery(
                        message.subject,
                        message.string(),
                        1,
                        message.reply === undefined ? {} : { replyTo: message.reply },
                      );
                      const outcome = await dispatch(delivery);
                      if (outcome.reply !== undefined && !message.respond(bytes(encodeReply(outcome.reply)))) {
                        throw new Error('@zmdb/transport-nats: NATS request has no reply subject');
                      }
                    });
                  },
                }
              : {
                  queue: subscription.queue,
                  callback(error, message): void {
                    if (error !== null) {
                      reportTransportError(options.onError, error);
                      return;
                    }
                    void inFlight.run(async () => {
                      if (!matcher.matches(message.subject)) {
                        throw new Error(
                          `@zmdb/transport-nats: NATS delivered unsubscribed subject "${message.subject}"`,
                        );
                      }
                      const delivery = decodeDelivery(
                        message.subject,
                        message.string(),
                        1,
                        message.reply === undefined ? {} : { replyTo: message.reply },
                      );
                      const outcome = await dispatch(delivery);
                      if (outcome.reply !== undefined && !message.respond(bytes(encodeReply(outcome.reply)))) {
                        throw new Error('@zmdb/transport-nats: NATS request has no reply subject');
                      }
                    });
                  },
                },
          );
          nextSubscriptions.push(opened);
        }
        await nextConnection.flush();
      } catch (error) {
        await nextConnection.close();
        throw error;
      }
      connection = nextConnection;
      activeSubscriptions = nextSubscriptions;
      void nextConnection.closed().then(
        error => {
          if (error !== undefined) {
            reportTransportError(options.onError, error);
          }
        },
        error => reportTransportError(options.onError, error),
      );
    },

    async send(request): Promise<MessageReply> {
      const activeConnection = connection;
      if (activeConnection === undefined) {
        throw new Error('@zmdb/transport-nats: NATS strategy is not listening');
      }
      if (request.signal.aborted) {
        throw abortError(request.signal);
      }

      const inbox = createInbox();
      let responseSubscription: Subscription | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = (): void => undefined;
      let resolveResponse = (_reply: MessageReply): void => undefined;
      let rejectResponse = (_error: unknown): void => undefined;
      let finished = false;
      const response = new Promise<MessageReply>((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      });
      const cleanup = (): void => {
        responseSubscription?.unsubscribe();
        request.signal.removeEventListener('abort', abort);
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
      const fail = (error: unknown): void => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        rejectResponse(error);
      };
      const succeed = (reply: MessageReply): void => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        resolveResponse(reply);
      };
      abort = (): void => fail(abortError(request.signal));

      try {
        responseSubscription = activeConnection.subscribe(inbox, {
          max: 1,
          callback(error, message): void {
            if (error !== null) {
              fail(error);
              return;
            }
            try {
              succeed(decodeReply(message.string()));
            } catch (decodeError) {
              fail(decodeError);
            }
          },
        });
        request.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          fail(new MessageTimeoutError(request.pattern, request.timeoutMs, request.correlationId));
        }, request.timeoutMs);
        await activeConnection.flush();
        if (!finished) {
          activeConnection.publish(
            request.pattern,
            bytes(encodeDelivery(request.payload, request, { correlationId: request.correlationId })),
            { reply: inbox },
          );
        }
      } catch (error) {
        fail(error);
      }
      return response;
    },

    async emit(pattern, payload, carrier): Promise<void> {
      const activeConnection = connection;
      if (activeConnection === undefined) {
        throw new Error('@zmdb/transport-nats: NATS strategy is not listening');
      }
      activeConnection.publish(pattern, bytes(encodeDelivery(payload, carrier)));
    },

    async close(graceMs): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      const activeConnection = connection;
      const subscriptionsToClose = activeSubscriptions;
      connection = undefined;
      activeSubscriptions = [];
      if (activeConnection === undefined) {
        return;
      }

      const graceful = (async (): Promise<void> => {
        await Promise.all(subscriptionsToClose.map(subscription => subscription.drain()));
        inFlight.stop();
        await inFlight.settled();
        await activeConnection.flush();
        await activeConnection.close();
      })();
      if (!(await withinGrace(graceful, graceMs))) {
        await activeConnection.close();
        throw new Error(`@zmdb/transport-nats: NATS strategy did not drain within ${String(graceMs)}ms`);
      }
    },
  };
}
