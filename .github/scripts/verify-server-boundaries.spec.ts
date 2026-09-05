import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeAppKernelBoundary, analyzeOptionalServerPackages } from './verify-server-boundaries.mjs';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, '.github', 'scripts', 'verify-server-boundaries.mjs');
const FIXTURES = join(ROOT, '.github', 'scripts', '__fixtures__', 'server-boundaries');
const BASELINE = join(ROOT, '.github', 'scripts', 'server-boundaries-baseline.json');

function verifyFixture(name: string, partial = false): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--root', join(FIXTURES, name), '--strict', ...(partial ? ['--partial'] : [])],
    { encoding: 'utf8' },
  );
}

describe('the optional server boundary verifier', () => {
  it('keeps one Symbol.metadata installation and one metadataOf implementation', () => {
    expect(analyzeAppKernelBoundary(ROOT)).toEqual([]);
  });

  it('accepts the complete positive package graph', () => {
    const result = verifyFixture('positive');
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports the live optional package graph independently of pending core work', () => {
    expect(analyzeOptionalServerPackages(ROOT)).toEqual([]);
    const result = spawnSync(process.execPath, [SCRIPT, '--strict', '--optional-packages-only'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('7 optional package manifests');
  });

  it('reports a planted optional-package peer leak through the scoped analysis', () => {
    expect(analyzeOptionalServerPackages(join(FIXTURES, 'multiple-peers'), { requireAll: false })).toContain(
      '@zmdb/transport-nats reaches external packages [@nats-io/transport-node, redis], expected [@nats-io/transport-node]',
    );
  });

  it.each([
    ['multiple-peers', 'reaches external packages [@nats-io/transport-node, redis]'],
    ['optional-peer', 'marks required peer @grpc/grpc-js optional'],
    ['core-leak', 'zmdb reaches optional server packages [@zmdb/transport-redis]'],
  ])('rejects the %s mutation fixture', (name, message) => {
    const result = verifyFixture(name, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('matches the checked-in live-tree baseline in its default mode', () => {
    const output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { readonly problems: readonly string[] };
    expect(output).toContain(`${String(baseline.problems.length)} frozen finding(s)`);
  });
});
