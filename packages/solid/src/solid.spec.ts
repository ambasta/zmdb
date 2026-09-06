import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const HOOK = resolve(ROOT, 'scripts/ts-specifier-hook.mjs');
const RUNNER = resolve(ROOT, 'fixtures/client-adapters/src/solid-runner.ts');

function runScenario(scenario: string, environment: 'browser' | 'server' = 'browser'): string {
  const conditions = environment === 'browser' ? ['--conditions=browser'] : [];
  return execFileSync(process.execPath, [...conditions, `--import=${HOOK}`, RUNNER, scenario], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

describe('@zmdb/solid context, resources and owner disposal (#695)', () => {
  it('isolates clients between Solid owners', () => {
    expect(runScenario('context')).toBe('context: ok');
  });

  it('owner disposal aborts an active request', () => {
    expect(runScenario('disposal')).toBe('disposal: ok');
  });

  it('resource refetch uses the latest input', () => {
    expect(runScenario('latest-input')).toBe('latest-input: ok');
  });

  it('Suspense receives the original pending promise', () => {
    expect(runScenario('suspense')).toBe('suspense: ok');
  });

  it('error boundaries receive the original client error', () => {
    expect(runScenario('error')).toBe('error: ok');
  });

  it('server owners do not share request state', () => {
    expect(runScenario('ssr', 'server')).toBe('ssr: ok');
  });

  it('passes the common generated-client adapter conformance cases', () => {
    expect(runScenario('common')).toBe('common: ok');
  });
});
