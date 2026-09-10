import assert from 'node:assert/strict';

import { createApplication } from '@zmdb/app';
import { EventPattern, transportExtension, type MessageContext } from '@zmdb/app/messaging';
import { Module } from '@zmdb/app/modules';
import { createKafkaStrategy } from '@zmdb/transport/kafka';
import type { Kafka } from 'kafkajs';

export async function applicationJourney(client: Kafka, topic: string, deadLetterTopic: string): Promise<void> {
  const delivered = Promise.withResolvers<number>();
  const invalid: unknown[] = [];
  const errors: unknown[] = [];
  function validate(raw: unknown): { id: number } {
    assert(typeof raw === 'object' && raw !== null);
    assert(raw !== null && 'id' in raw && typeof raw.id === 'number');
    return { id: raw.id };
  }
  class Consumer {
    @EventPattern(topic, validate)
    handle(context: MessageContext<{ id: number }>): void {
      delivered.resolve(context.payload.id);
    }
  }
  @Module({ controllers: [Consumer] })
  class ApplicationModule {}
  const strategy = createKafkaStrategy({
    client,
    groupId: `${topic}.app`,
    topics: [topic],
    deadLetterTopic,
    partitionsConsumedConcurrently: 1,
    fromBeginning: true,
    onError: error => errors.push(error),
  });
  const app = createApplication(ApplicationModule, {
    graceMs: 5000,
    extensions: [
      transportExtension({
        transports: [strategy],
        dispatcher: {
          onUnhandled: message => errors.push(message),
          onInvalidPayload: (_message, error) => invalid.push(error),
          onHandlerError: (_message, error) => errors.push(error),
        },
      }),
    ],
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await app.init();
    await strategy.emit(topic, { id: 'invalid' });
    await strategy.emit(topic, { id: 37 });
    const result = await Promise.race([
      delivered.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Kafka application delivery timed out')), 15000);
      }),
    ]);
    assert.equal(result, 37);
    assert.equal(invalid.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    clearTimeout(timer);
    await app[Symbol.asyncDispose]();
  }
  await assert.rejects(strategy.emit(topic, { id: 38 }), /closed/i);
}
