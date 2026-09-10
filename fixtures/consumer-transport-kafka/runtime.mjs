import assert from 'node:assert/strict';

import { encodeDelivery } from '@zmdb/app/messaging';
import { createKafkaStrategy } from '@zmdb/transport/kafka';
import { Kafka, logLevel } from 'kafkajs';

import { applicationJourney } from './application.js';

const endpoint = process.env.ZMDB_KAFKA_URL;
assert(endpoint, 'explicit Kafka integration requires ZMDB_KAFKA_URL');
const client = new Kafka({
  brokers: [endpoint],
  clientId: 'zmdb-installed-kafka',
  logLevel: logLevel.NOTHING,
  connectionTimeout: 5000,
  requestTimeout: 10000,
  retry: { retries: 3 },
});
const admin = client.admin();
const writer = client.producer({ allowAutoTopicCreation: false });
const observer = client.consumer({ groupId: `zmdb-observer-${crypto.randomUUID()}`, allowAutoTopicCreation: false });
const prefix = `zmdb761-${crypto.randomUUID()}`;
const source = `${prefix}.source`,
  dead = `${prefix}.dead`,
  appTopic = `${prefix}.app`;
const groupId = `${prefix}.worker`;
const topics = [source, dead, appTopic];
const errors = [],
  seen = [],
  deadLetters = [];
const releaseRetry = Promise.withResolvers();
const releaseStuck = Promise.withResolvers();
let active;

async function until(predicate, description) {
  const deadline = Date.now() + 20000;
  do {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(`Kafka integration timed out: ${description}`);
}

async function committed(partition = 0) {
  const offsets = await admin.fetchOffsets({ groupId, topics: [source], resolveOffsets: false });
  return offsets.find(entry => entry.topic === source)?.partitions.find(entry => entry.partition === partition)?.offset;
}

function strategy() {
  return createKafkaStrategy({
    client,
    groupId,
    topics: [source],
    deadLetterTopic: dead,
    partitionsConsumedConcurrently: 2,
    fromBeginning: true,
    heartbeatIntervalMs: 500,
    sessionTimeoutMs: 10000,
    errorRetryMs: 50,
    onError: error => errors.push(error),
  });
}

try {
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: topics.map(topic => ({ topic, numPartitions: topic === source ? 2 : 1, replicationFactor: 1 })),
  });
  await writer.connect();
  await observer.connect();
  await observer.subscribe({ topics: [dead], fromBeginning: true });
  await observer.run({
    eachMessage: async ({ message }) => {
      deadLetters.push(message);
    },
  });
  active = strategy();
  await active.listen(async message => {
    seen.push(message);
    if (message.parseError) return { settlement: { kind: 'dead', reason: 'invalid wire' } };
    if (message.payload.id === 'retry') {
      if (message.deliveryAttempt === 1) return { settlement: { kind: 'retry', afterMs: 50 } };
      await releaseRetry.promise;
    }
    if (message.payload.id === 'dead') return { settlement: { kind: 'dead', reason: 'rejected order' } };
    if (message.payload.id === 'stuck') await releaseStuck.promise;
    return { settlement: { kind: 'ack' } };
  });
  await writer.send({
    topic: source,
    acks: -1,
    messages: [
      ...['ack', 'retry', 'after-retry', 'dead'].map(id => ({
        partition: 0,
        key: 'customer-7',
        value: encodeDelivery({ id }, undefined),
      })),
      { partition: 0, key: 'customer-7', value: 'malformed' },
      { partition: 1, value: encodeDelivery({ id: 'other-partition' }, undefined) },
    ],
  });
  await until(
    () => seen.some(message => message.payload?.id === 'retry' && message.deliveryAttempt === 2),
    'retry redelivery',
  );
  await until(() => seen.some(message => message.payload?.id === 'other-partition'), 'independent partition progress');
  const beforeRetry = await committed();
  assert.equal(beforeRetry, '1', 'retry must not advance past its unhandled offset');
  assert(!seen.some(message => message.payload?.id === 'after-retry'), 'partition order was violated');
  releaseRetry.resolve();
  await until(async () => (await committed()) === '5', 'source settlement offset');
  await until(() => deadLetters.length === 2, 'acknowledged dead-letter records');
  const afterSettlement = await committed();
  const normalDead = deadLetters.find(message => message.headers['zmdb-source-offset'].toString() === '3');
  assert(normalDead);
  assert.equal(normalDead.value.toString(), encodeDelivery({ id: 'dead' }, undefined));
  assert.equal(normalDead.key.toString(), 'customer-7');
  assert.equal(normalDead.headers['zmdb-source-topic'].toString(), source);
  assert.equal(normalDead.headers['zmdb-source-partition'].toString(), '0');
  assert.equal(normalDead.headers['zmdb-dead-reason'].toString(), 'rejected order');
  assert.equal(normalDead.headers['zmdb-delivery-attempt'].toString(), '1');
  assert.equal(
    deadLetters.find(message => message.headers['zmdb-source-offset'].toString() === '4')?.value.toString(),
    'malformed',
  );

  await writer.send({
    topic: source,
    acks: -1,
    messages: [{ partition: 0, value: encodeDelivery({ id: 'stuck' }, undefined) }],
  });
  await until(() => seen.some(message => message.payload?.id === 'stuck'), 'accepted uncommitted record');
  assert.equal(await committed(), '5');
  await assert.rejects(active.close(50), /grace|drain|timeout/i);
  await assert.rejects(active.emit(source, {}), /closed/i);
  active = strategy();
  const replay = [];
  await active.listen(async message => {
    replay.push(message);
    return { settlement: { kind: 'ack' } };
  });
  await until(async () => (await committed()) === '6', 'restart replay commit');
  assert.deepEqual(
    replay.map(message => [message.payload.id, message.deliveryAttempt]),
    [['stuck', 1]],
  );
  const afterReplay = await committed();
  releaseStuck.resolve();
  await active.close(5000);
  active = undefined;

  await applicationJourney(client, appTopic, dead);
  await writer.send({ topic: appTopic, acks: -1, messages: [{ value: encodeDelivery({ id: 99 }, undefined) }] });
  assert.equal((await admin.fetchTopicOffsets(appTopic)).length, 1, 'caller-owned admin remains usable');
  assert.deepEqual(errors, [], 'adapter reported an unexpected broker error');
  console.log(
    JSON.stringify({
      wire: {
        beforeRetry,
        afterSettlement,
        afterReplay,
        retryAttempts: seen.filter(message => message.payload?.id === 'retry').map(message => message.deliveryAttempt),
        deadLetters: 2,
        restartAttempts: replay.map(message => message.deliveryAttempt),
        appValidation: true,
        callerResourcesUsable: true,
      },
    }),
  );
} finally {
  releaseRetry.resolve();
  releaseStuck.resolve();
  await active?.close(5000).catch(error => errors.push(error));
  await observer.disconnect();
  await writer.disconnect();
  await admin.deleteTopics({ topics }).catch(() => undefined);
  const remaining = await admin.listTopics();
  assert(!remaining.some(topic => topics.includes(topic)), 'owned Kafka topics survived cleanup');
  await admin.disconnect();
}
