import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { analyzeAppKernelBoundary, analyzeOptionalServerPackages } from './verify-server-boundaries.mjs';

const ROOT = process.cwd();
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: ['release'] });
if (GOVERNANCE.architecture === null) throw new Error('governance snapshot has no architecture');
if (GOVERNANCE.queries.release === undefined) throw new Error('governance snapshot has no release query');
const SCRIPT = join(ROOT, '.github', 'scripts', 'verify-server-boundaries.mjs');
const FIXTURES = join(ROOT, '.github', 'scripts', '__fixtures__', 'server-boundaries');

function verifyFixture(name: string, partial = false) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--root', join(FIXTURES, name), '--strict', ...(partial ? ['--partial'] : [])],
    { encoding: 'utf8' },
  );
}

describe('the optional server boundary verifier', () => {
  it('keeps one Symbol.metadata installation and one metadataOf implementation', () => {
    expect(
      analyzeAppKernelBoundary(ROOT, {
        architecture: GOVERNANCE.architecture,
        release: GOVERNANCE.queries.release,
      }),
    ).toEqual([]);
  });

  it('accepts the complete positive package graph', () => {
    const result = verifyFixture('positive');
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports the live optional package graph independently of pending core work', () => {
    expect(
      analyzeOptionalServerPackages(ROOT, {
        architecture: GOVERNANCE.architecture,
        release: GOVERNANCE.queries.release,
      }),
    ).toEqual([]);
    const result = spawnSync(process.execPath, [SCRIPT, '--strict', '--optional-packages-only'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('7 optional package manifests');
  });

  it('reports a planted optional-package peer leak through the scoped analysis', async () => {
    const root = join(FIXTURES, 'multiple-peers');
    const snapshot = await loadGovernanceSnapshot({ root, checks: [] });
    if (snapshot.architecture === null) throw new Error('server fixture has no architecture');
    expect(analyzeOptionalServerPackages(root, { architecture: snapshot.architecture, requireAll: false })).toContain(
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

  it('matches the empty owned live-tree exception registry in its default mode', () => {
    const output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(output).toContain('0 owned exception record(s)');
    expect(output).toContain('0 measured occurrence(s)');
    expect(output).toContain('strict target is clean');
  });
});
