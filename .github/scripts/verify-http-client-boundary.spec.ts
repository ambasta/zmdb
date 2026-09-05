import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./verify-http-client-boundary.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/http-client-boundary/', import.meta.url));
const ROOT = process.cwd();

interface Verification {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function verify(manifest: string, generated: string, regenerated: string): Verification {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--manifest', manifest, '--generated', generated, '--regenerated', regenerated],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function fixture(name: string): string {
  return fileURLToPath(new URL(name, new URL('./__fixtures__/http-client-boundary/', import.meta.url)));
}

describe('the HTTP client dependency and generated-source verifier', () => {
  it('accepts the dependency-free deterministic credential-free fixture', () => {
    const result = verify(
      fixture('valid.package.json'),
      fixture('valid.generated.ts'),
      fixture('valid.regenerated.ts'),
    );
    expect(result, result.stderr).toMatchObject({ status: 0 });
    expect(result.stdout).toContain('dependency, determinism, generated-source, and secret boundaries verified');
  });

  it('rejects dependency and peer-dependency fixtures', () => {
    const result = verify(
      fixture('dependency.package.json'),
      fixture('valid.generated.ts'),
      fixture('valid.regenerated.ts'),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@zmdb/client dependencies must be empty');
    expect(result.stderr).toContain('@zmdb/client peerDependencies must be empty');
  });

  it('rejects a credential-like literal in generated source', () => {
    const result = verify(
      fixture('valid.package.json'),
      fixture('secret.generated.ts'),
      fixture('secret.generated.ts'),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('credential-like literal');
  });

  it('rejects web imports, TypeIR walkers, and workspace paths', () => {
    const result = verify(
      fixture('valid.package.json'),
      fixture('boundary.generated.ts'),
      fixture('boundary.generated.ts'),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('imports forbidden runtime boundary "@zmdb/web/openapi"');
    expect(result.stderr).toContain('forbidden TypeIR');
    expect(result.stderr).toContain('absolute, file, or workspace path');
  });

  it('rejects two generated outputs whose bytes differ', () => {
    const result = verify(fixture('valid.package.json'), fixture('valid.generated.ts'), fixture('drift.generated.ts'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not byte-identical');
  });

  it('@zmdb/client has zero dependencies', () => {
    const result = verify(
      `${ROOT}/packages/client/package.json`,
      fixture('valid.generated.ts'),
      fixture('valid.regenerated.ts'),
    );
    expect(result, result.stderr).toMatchObject({ status: 0 });
  });

  it('keeps every verifier fixture under the issue-scoped fixture root', () => {
    expect(FIXTURES).toContain('.github/scripts/__fixtures__/http-client-boundary/');
  });
});
