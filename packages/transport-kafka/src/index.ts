import {
  decodeDelivery,
  encodeDelivery,
  reportTransportError,
  TransportUnsupportedError,
  withinGrace,
  type DispatchOutcome,
  type RawMessage,
  type TransportErrorSink,
  type TransportStrategy,
} from '@zmdb/app/messaging';
import type { Consumer, EachBatchPayload, Kafka, KafkaMessage, Producer } from 'kafkajs';

export interface KafkaStrategyOptions {
  readonly client: Kafka;
  readonly groupId: string;
  readonly topics: readonly string[];
  readonly deadLetterTopic: string;
  readonly partitionsConsumedConcurrently: number;
  readonly onError: TransportErrorSink;
  readonly name?: string;
  readonly fromBeginning?: boolean;
  readonly sessionTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly errorRetryMs?: number;
}

function topicName(value: string): string {
  if (!/^[a-zA-Z0-9._-]{1,249}$/.test(value) || value === '.' || value === '..') {
    throw new RangeError('@zmdb/transport-kafka: invalid Kafka topic');
  }
  return value;
}

function boundedInteger(value: number, description: string, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum || value > 2147483647) {
    throw new RangeError(`@zmdb/transport-kafka: ${description} is outside its integer bound`);
  }
  return value;
}

/** An event transport with ordered manual commits and partition-local retries. */
export function createKafkaStrategy(options: KafkaStrategyOptions): TransportStrategy {
  const { client, groupId, onError } = options;
  const topics = options.topics.map(topicName);
  const deadLetterTopic = topicName(options.deadLetterTopic);
  const concurrency = boundedInteger(options.partitionsConsumedConcurrently, 'partition concurrency');
  const sessionTimeout = boundedInteger(options.sessionTimeoutMs ?? 30000, 'session timeout');
  const heartbeatInterval = boundedInteger(options.heartbeatIntervalMs ?? 3000, 'heartbeat interval');
  const errorRetryMs = boundedInteger(options.errorRetryMs ?? 1000, 'error retry delay');
  const name = options.name ?? 'kafka';
  const fromBeginning = options.fromBeginning ?? false;
  if (
    !groupId ||
    !name ||
    !topics.length ||
    new Set(topics).size !== topics.length ||
    topics.includes(deadLetterTopic)
  ) {
    throw new RangeError(
      '@zmdb/transport-kafka: explicit unique input topics, a separate dead-letter topic and a group are required',
    );
  }
  if (heartbeatInterval >= sessionTimeout) {
    throw new RangeError('@zmdb/transport-kafka: heartbeat interval must be smaller than session timeout');
  }

  let phase: 'idle' | 'starting' | 'listening' | 'closing' | 'closed' = 'idle';
  let consumer: Consumer | undefined;
  let producer: Producer | undefined;
  let startup: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let disconnected: Promise<void> | undefined;
  let generation = 0;
  const cancelled = new AbortController();
  const tasks = new Set<Promise<void>>();
  const attempts = new Map<string, { offset: string; count: number }>();
  const retries = new Map<string, { timer: ReturnType<typeof setTimeout>; resume: () => void }>();
  const removeListeners: (() => void)[] = [];
  const closedError = (): Error => new Error('@zmdb/transport-kafka: strategy is closed');
  const report = (error: unknown): void => reportTransportError(onError, error);

  function track(action: Promise<void>): Promise<void> {
    tasks.add(action);
    void action.finally(() => tasks.delete(action)).catch(() => undefined);
    return action;
  }

  async function abortable<T>(action: Promise<T>): Promise<T> {
    cancelled.signal.throwIfAborted();
    const interrupted = Promise.withResolvers<never>();
    const abort = (): void => interrupted.reject(cancelled.signal.reason);
    cancelled.signal.addEventListener('abort', abort, { once: true });
    try {
      return await Promise.race([action, interrupted.promise]);
    } finally {
      cancelled.signal.removeEventListener('abort', abort);
    }
  }

  function cancelRetries(resume: boolean): void {
    for (const pending of retries.values()) {
      clearTimeout(pending.timer);
      if (resume) {
        try {
          pending.resume();
        } catch (error) {
          report(error);
        }
      }
    }
    retries.clear();
  }

  function invalidate(): void {
    generation += 1;
    attempts.clear();
    cancelRetries(phase === 'listening');
  }

  function disconnect(): Promise<void> {
    disconnected ??= (async () => {
      for (const remove of removeListeners) remove();
      const results = await Promise.allSettled([consumer?.disconnect(), producer?.disconnect()]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })();
    return disconnected;
  }

  function owned(batch: EachBatchPayload, owner: number): boolean {
    return (
      phase !== 'closed' && !cancelled.signal.aborted && generation === owner && batch.isRunning() && !batch.isStale()
    );
  }

  function retry(batch: EachBatchPayload, offset: string, owner: number, delay: number): void {
    const activeConsumer = consumer;
    if (phase !== 'listening' || !owned(batch, owner) || !activeConsumer) return;
    const { topic, partition } = batch.batch;
    const key = `${topic}\0${String(partition)}`;
    activeConsumer.seek({ topic, partition, offset });
    const resume = batch.pause();
    const previous = retries.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      retries.delete(key);
      if (phase !== 'listening' || generation !== owner || !batch.isRunning()) return;
      try {
        resume();
      } catch (error) {
        report(error);
      }
    }, delay);
    retries.set(key, { timer, resume });
  }

  async function processRecord(
    batch: EachBatchPayload,
    message: KafkaMessage,
    dispatch: (message: RawMessage) => Promise<DispatchOutcome>,
    owner: number,
  ): Promise<boolean> {
    const activeConsumer = consumer;
    const activeProducer = producer;
    if (!activeConsumer || !activeProducer || !owned(batch, owner)) return false;
    const { topic, partition } = batch.batch;
    const key = `${topic}\0${String(partition)}`;
    const previous = attempts.get(key);
    const attempt = previous?.offset === message.offset ? previous.count + 1 : 1;
    attempts.set(key, { offset: message.offset, count: attempt });
    const heartbeatFailure = Promise.withResolvers<never>();
    const heartbeat = setInterval(() => {
      void batch.heartbeat().catch(error => heartbeatFailure.reject(error));
    }, heartbeatInterval);
    try {
      await abortable(Promise.race([batch.heartbeat(), heartbeatFailure.promise]));
      if (!owned(batch, owner)) return false;
      const delivery = decodeDelivery(topic, message.value?.toString('utf8') ?? '', attempt);
      const outcome = await abortable(Promise.race([dispatch(delivery), heartbeatFailure.promise]));
      if (!owned(batch, owner)) return false;
      if (outcome.settlement.kind === 'retry') {
        retry(batch, message.offset, owner, boundedInteger(outcome.settlement.afterMs, 'retry delay', 0));
        return false;
      }
      if (outcome.settlement.kind === 'dead') {
        await abortable(
          activeProducer.send({
            topic: deadLetterTopic,
            acks: -1,
            messages: [
              {
                key: message.key,
                value: message.value,
                headers: {
                  ...message.headers,
                  'zmdb-source-topic': topic,
                  'zmdb-source-partition': String(partition),
                  'zmdb-source-offset': message.offset,
                  'zmdb-delivery-attempt': String(attempt),
                  'zmdb-dead-reason': outcome.settlement.reason,
                },
              },
            ],
          }),
        );
      }
      if (!owned(batch, owner)) return false;
      await abortable(batch.heartbeat());
      if (!owned(batch, owner)) return false;
      await abortable(
        activeConsumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]),
      );
      if (!owned(batch, owner)) return false;
      batch.resolveOffset(message.offset);
      attempts.delete(key);
      return true;
    } catch (error) {
      if (!cancelled.signal.aborted) {
        report(error);
        retry(batch, message.offset, owner, errorRetryMs);
      }
      return false;
    } finally {
      clearInterval(heartbeat);
    }
  }

  const strategy: TransportStrategy = {
    name,
    capabilities: { redelivery: true, deadLetter: true, requestResponse: false },
    async listen(dispatch) {
      if (phase === 'closing' || phase === 'closed') throw closedError();
      if (phase !== 'idle') throw new Error('@zmdb/transport-kafka: strategy is already listening');
      phase = 'starting';
      startup = (async () => {
        try {
          producer = client.producer({ allowAutoTopicCreation: false });
          consumer = client.consumer({ groupId, allowAutoTopicCreation: false, sessionTimeout, heartbeatInterval });
          removeListeners.push(
            consumer.on(consumer.events.REBALANCING, invalidate),
            consumer.on(consumer.events.GROUP_JOIN, invalidate),
            consumer.on(consumer.events.CRASH, event => {
              invalidate();
              report(event.payload.error);
            }),
          );
          await abortable(producer.connect());
          if (phase !== 'starting') throw closedError();
          await abortable(consumer.connect());
          if (phase !== 'starting') throw closedError();
          await abortable(consumer.subscribe({ topics, fromBeginning }));
          if (phase !== 'starting') throw closedError();
          phase = 'listening';
          await abortable(
            consumer.run({
              autoCommit: false,
              eachBatchAutoResolve: false,
              partitionsConsumedConcurrently: concurrency,
              eachBatch: batch =>
                track(
                  (async () => {
                    const owner = generation;
                    for (const message of batch.batch.messages) {
                      if (phase !== 'listening' || !owned(batch, owner)) break;
                      if (!(await processRecord(batch, message, dispatch, owner))) break;
                    }
                  })(),
                ),
            }),
          );
          if (phase !== 'listening') throw closedError();
        } catch (error) {
          phase = 'closed';
          invalidate();
          await disconnect().catch(report);
          throw error;
        }
      })();
      await startup;
    },
    async send() {
      throw new TransportUnsupportedError(name);
    },
    async emit(pattern, payload, carrier) {
      if (phase === 'closing' || phase === 'closed') throw closedError();
      if (phase !== 'listening' || !producer) throw new Error('@zmdb/transport-kafka: strategy is not listening');
      const topic = topicName(pattern);
      const value = encodeDelivery(payload, carrier);
      await track(abortable(producer.send({ topic, acks: -1, messages: [{ value }] })).then(() => undefined));
    },
    async close(graceMs) {
      boundedInteger(graceMs, 'close grace', 0);
      if (phase === 'closed') return;
      if (closing) return closing;
      phase = 'closing';
      cancelRetries(false);
      closing = (async () => {
        const graceful = (async () => {
          await startup?.catch(() => undefined);
          if (disconnected) return;
          consumer?.pause(topics.map(topic => ({ topic })));
          await Promise.all(tasks);
          await consumer?.stop();
          await disconnect();
        })();
        let timedOut = false;
        try {
          timedOut = !(await withinGrace(graceful, graceMs));
        } finally {
          phase = 'closed';
          cancelled.abort(closedError());
          invalidate();
          void disconnect().catch(report);
        }
        if (timedOut) throw new Error(`@zmdb/transport-kafka: strategy did not drain within ${String(graceMs)}ms`);
      })();
      await closing;
    },
  };
  return strategy;
}
