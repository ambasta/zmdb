import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  withPackedBuildLock,
} from '../../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = process.cwd();
const CONSUMER_VERIFIER = join(ROOT, 'fixtures', 'consumer-server-integrations', 'verify-installed.mjs');
const TYPESCRIPT_HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const IMPLEMENTED_SERVER_PACKAGES = [
  '@zmdb/protobuf',
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
] as const;
const PENDING_SERVER_PACKAGES = [] as const;
const REQUIRED_SERVICE_ENV = ['ZMDB_NATS_URL', 'ZMDB_RABBITMQ_URL', 'ZMDB_REDIS_URL', 'ZMDB_PG'] as const;
const HAS_REQUIRED_SERVICES = REQUIRED_SERVICE_ENV.every(name => process.env[name] !== undefined);
let installedConsumers: string | undefined;
function installedConsumerOutput(): string {
  installedConsumers ??= withPackedBuildLock(ROOT, () =>
    execFileSync(
      process.execPath,
      [CONSUMER_VERIFIER, '--integrations', ...(HAS_REQUIRED_SERVICES ? ['--require-services'] : [])],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    ),
  );
  return installedConsumers;
}

describe('optional server package isolation (#655)', () => {
  it.each(IMPLEMENTED_SERVER_PACKAGES)('imports %s from its dedicated package', packageName => {
    const result = spawnSync(
      process.execPath,
      ['--import', TYPESCRIPT_HOOK, '--input-type=module', '--eval', `await import(${JSON.stringify(packageName)})`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.fails.each(PENDING_SERVER_PACKAGES)('imports %s from its dedicated package', packageName => {
    const result = spawnSync(
      process.execPath,
      ['--import', TYPESCRIPT_HOOK, '--input-type=module', '--eval', `await import(${JSON.stringify(packageName)})`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it(
    'installing zmdb does not install any optional server integration',
    () => {
      const output = withPackedBuildLock(ROOT, () =>
        execFileSync(process.execPath, [CONSUMER_VERIFIER, '--core'], {
          cwd: ROOT,
          encoding: 'utf8',
        }),
      );
      expect(output).toMatch(/0 optional server packages or peers/);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'every integration imports and typechecks from an installed tarball',
    () => {
      expect(installedConsumerOutput()).toContain('installed consumer: @zmdb/protobuf runtime and declarations OK');
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it('required installed consumers refuse missing live services', () => {
    const env = { ...process.env };
    for (const name of REQUIRED_SERVICE_ENV) delete env[name];
    const result = spawnSync(process.execPath, [CONSUMER_VERIFIER, '--integrations', '--require-services'], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'required live-service lane is missing environment variable(s): ZMDB_PG, ZMDB_NATS_URL, ZMDB_RABBITMQ_URL, ZMDB_REDIS_URL',
    );
  });

  it.skipIf(!HAS_REQUIRED_SERVICES)(
    'Installed smoke consumers execute every public integration',
    () => {
      expect(installedConsumerOutput()).toContain(
        'required live-service lane: 7 installed integration consumer(s) executed',
      );
    },
    300_000,
  );

  it.each(IMPLEMENTED_SERVER_PACKAGES)(
    '%s imports and typechecks from an installed tarball',
    packageName => {
      expect(installedConsumerOutput()).toContain(`installed consumer: ${packageName} runtime and declarations OK`);
    },
    180_000,
  );
});
