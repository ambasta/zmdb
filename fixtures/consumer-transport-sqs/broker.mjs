import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';

const images = {
  broker:
    'docker.io/softwaremill/elasticmq-native@sha256:8383f29ad746c12981ca2128f689a4b4a93815235f1a7851d2f165316503d132',
  wire: 'docker.io/wiremock/wiremock@sha256:b8f48d6183927a43ead432ca4eaf8fd5ab2ee5f3e0ff65f7fbbb3d3189a34c5c',
};
const credentials = { accessKeyId: 'local-sqs-fixture', secretAccessKey: 'local-sqs-fixture' };
export const sdk = endpoint => new SQSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 });

export async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  while (Date.now() < deadline) {
    try {
      return await check();
    } catch (error) {
      failure = error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw failure ?? new Error('SQS fixture condition timed out');
}

export async function startFixtures() {
  const engine =
    process.env.ZMDB_CONTAINER_ENGINE ??
    (spawnSync('podman', ['version'], { stdio: 'ignore' }).status === 0 ? 'podman' : 'docker');
  const directory = await mkdtemp(join(dirname(process.cwd()), 'zmdb-760-broker-'));
  const owned = [];
  const run = args => {
    const result = spawnSync(engine, args, { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${engine} ${args[0]} failed: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  };
  const stop = async () => {
    const failures = [];
    for (const id of owned.toReversed()) {
      try {
        run(['rm', '--force', id]);
      } catch (error) {
        failures.push(error);
      }
    }
    await rm(directory, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, 'SQS fixture cleanup failed');
  };
  try {
    const config = join(directory, 'elasticmq.conf');
    await writeFile(
      config,
      'include classpath("application.conf")\nnode-address.host = "*"\nrest-sqs.sqs-limits = strict\n',
    );
    const start = (kind, port, extra = []) => {
      const name = `zmdb-760-${kind}-${globalThis.crypto.randomUUID()}`;
      const id = run(['run', '--detach', '--name', name, '--publish', `127.0.0.1::${port}`, ...extra, images[kind]]);
      owned.push(id);
      const address = run(['port', id, `${port}/tcp`]);
      assert.match(address, /^127\.0\.0\.1:\d+$/);
      return `http://${address}`;
    };
    const endpoint = start('broker', 9324, ['--volume', `${config}:/opt/elasticmq.conf:ro`]);
    const wire = start('wire', 8080);
    const client = sdk(endpoint);
    try {
      await waitFor(() => client.send(new ListQueuesCommand({}), { abortSignal: AbortSignal.timeout(1000) }), 20_000);
    } finally {
      client.destroy();
    }
    await waitFor(
      async () =>
        assert.equal((await fetch(`${wire}/__admin/mappings`, { signal: AbortSignal.timeout(1000) })).status, 200),
      20_000,
    );
    return { endpoint, wire, images, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanup) {
      throw new SuppressedError(cleanup, error, 'SQS fixture startup and cleanup failed');
    }
    throw error;
  }
}
