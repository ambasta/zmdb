import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

import { Kafka, logLevel } from 'kafkajs';

const execute = promisify(execFile);
export const KAFKA_IMAGE =
  'docker.io/apache/kafka@sha256:77e3df9054047a88b520d0cc46e16696d3b22022e1d580aeccd2632df6532837';

export async function startKafkaBroker() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => (error ? reject(error) : resolve())));
  const name = `zmdb-761-kafka-${crypto.randomUUID()}`;
  const endpoint = `127.0.0.1:${port}`;
  let created = false;
  const close = async () => {
    if (!created) return;
    await execute('podman', ['rm', '--force', '--volumes', name], { timeout: 30000 });
    created = false;
    const inspected = await execute('podman', ['ps', '--all', '--filter', `name=^${name}$`, '--format', '{{.Names}}']);
    assert.equal(inspected.stdout.trim(), '', 'owned Kafka container survived cleanup');
  };
  try {
    await execute(
      'podman',
      [
        'run',
        '--detach',
        '--name',
        name,
        '--publish',
        `127.0.0.1:${port}:9092`,
        '--env',
        'KAFKA_NODE_ID=1',
        '--env',
        'KAFKA_PROCESS_ROLES=broker,controller',
        '--env',
        'KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093',
        '--env',
        `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${endpoint}`,
        '--env',
        'KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER',
        '--env',
        'KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
        '--env',
        'KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093',
        '--env',
        'KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1',
        '--env',
        'KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1',
        '--env',
        'KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1',
        '--env',
        'KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0',
        KAFKA_IMAGE,
      ],
      { timeout: 120000 },
    );
    created = true;
    const admin = new Kafka({
      brokers: [endpoint],
      clientId: name,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 500,
      requestTimeout: 1000,
      retry: { retries: 0 },
    }).admin();
    try {
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          await admin.connect();
          await admin.listTopics();
          ready = true;
          break;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      assert(ready, 'owned Kafka broker did not become ready');
    } finally {
      await admin.disconnect();
    }
    return { endpoint, name, image: KAFKA_IMAGE, close };
  } catch (error) {
    if (created)
      error.message += `\n${(await execute('podman', ['logs', name]).catch(() => ({ stdout: '', stderr: '' }))).stderr}`;
    await close();
    throw error;
  }
}
