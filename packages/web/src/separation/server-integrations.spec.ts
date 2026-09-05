import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BOUNDARY_VERIFIER = join(ROOT, '.github', 'scripts', 'verify-server-boundaries.mjs');
const CONSUMER_VERIFIER = join(ROOT, 'fixtures', 'consumer-server-integrations', 'verify-installed.mjs');
const SERVER_PACKAGES = [
  '@zmdb/protobuf',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
] as const;
const REAL_SERVICE_TITLES = [
  'all four call types round-trip against a real gRPC server',
  'one authorisation function written against WithHeaders is callable with a GrpcCall',
  'serves an external call with no deadline and reports an infinite budget',
  'bidirectional: the request half closing does not close the response half',
  'bidirectional request validation failures reject the response iterator',
  'propagates a gRPC deadline and cancels the handler when it expires',
  'propagates the remaining deadline budget to an outbound typed call',
  'unary: a caller that cancels aborts the signal and the handler runs its finally',
  'server streaming: a caller that stops reading aborts the signal and runs the handler finally',
  'a for-await over call.payload is interrupted only if the request iterable observes call.signal',
  'rejects malformed protobuf frames as INVALID_ARGUMENT',
  'validates metadata before exposing it to a handler',
  'maps private failures to a fixed INTERNAL response and reports the real error',
  'sends only the safe status and details from GrpcError',
  'a failed bind rejects init and closes what was already opened',
  'forces shutdown after the configured grace period',
  'loses messages published with no connected consumer and delivers live messages',
  'uses a wildcard queue group for concrete event and request subjects',
  'redelivers through the TTL retry queue and dead-letters invalid JSON',
  'round-trips through a real pg Pool without taking ownership of it',
  'adapts a meter without constructing or requiring a tracer',
  'maps every span kind, remote parent, tracestate and rename through the real SDK',
  'exports driver spans as clients and message spans as consumers with both W3C headers',
] as const;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'dist' || entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('optional server package isolation (#655)', () => {
  it.fails.each(SERVER_PACKAGES)('imports %s from its dedicated package', packageName => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(packageName)})`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.fails('each adapter package reaches exactly one third-party peer', () => {
    const result = spawnSync(process.execPath, [BOUNDARY_VERIFIER, '--strict'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('installing zmdb does not install any optional server integration', () => {
    const output = execFileSync(process.execPath, [CONSUMER_VERIFIER, '--core'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/0 optional server packages or peers/);
  }, 180_000);

  it.fails('every integration imports and typechecks from an installed tarball', () => {
    execFileSync(process.execPath, [CONSUMER_VERIFIER, '--integrations'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  }, 300_000);

  it('retains every existing real-service title', () => {
    const source = filesUnder(join(ROOT, 'packages'))
      .filter(path => path.endsWith('.spec.ts'))
      .map(path => readFileSync(path, 'utf8'))
      .join('\n');

    for (const title of REAL_SERVICE_TITLES) {
      expect(source, title).toContain(`it('${title}'`);
    }
  });
});
