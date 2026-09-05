import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));
const CONSUMER = fileURLToPath(new URL('../../../fixtures/consumer-http-client/verify-installed.mjs', import.meta.url));
const BOUNDARY = fileURLToPath(new URL('../../../.github/scripts/verify-http-client-boundary.mjs', import.meta.url));
const GENERATED = fileURLToPath(
  new URL('../../../.github/scripts/__fixtures__/http-client-boundary/valid.generated.ts', import.meta.url),
);
const REGENERATED = fileURLToPath(
  new URL('../../../.github/scripts/__fixtures__/http-client-boundary/valid.regenerated.ts', import.meta.url),
);

describe('@zmdb/client installed package boundary', () => {
  it('has no dependency or peer dependency', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    expect(manifest.name).toBe('@zmdb/client');
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it('has no web-framework, reflection, OpenAPI, Node, or external runtime reachability', () => {
    const result = spawnSync(
      process.execPath,
      [BOUNDARY, '--manifest', MANIFEST, '--generated', GENERATED, '--regenerated', REGENERATED],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('imports with no installed package except @zmdb/client', () => {
    const result = spawnSync(process.execPath, [CONSUMER], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('only @zmdb/client installed');
  }, 120_000);
});
