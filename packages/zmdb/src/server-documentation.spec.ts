import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

interface ServerJourney {
  readonly installed: {
    readonly directDependencies: readonly string[];
    readonly typecheck: number;
    readonly workspaceLinks: readonly string[];
  };
  readonly invalid: { readonly status: number; readonly orders: number; readonly jobs: number };
  readonly valid: {
    readonly status: number;
    readonly entity: unknown;
    readonly stored: readonly unknown[];
    readonly delivered: readonly unknown[];
    readonly completedJobs: number;
  };
  readonly lifecycle: {
    readonly initialized: number;
    readonly shutdowns: number;
    readonly listenerClosed: boolean;
    readonly portRebound: boolean;
    readonly databaseClosed: boolean;
    readonly storeClosed: boolean;
  };
  readonly failures: readonly string[];
  readonly cleaned: boolean;
}

const execute = promisify(execFile);
const root = process.cwd();
let measured: Promise<ServerJourney> | undefined;
function journey(): Promise<ServerJourney> {
  measured ??= execute(
    process.execPath,
    [join(root, 'fixtures/consumer-server-core/verify-installed.mjs'), '--documented'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: PACKED_BUILD_TEST_TIMEOUT_MS - 10_000 },
  ).then(({ stdout }) => JSON.parse(stdout) as ServerJourney);
  return measured;
}

describe('documented HTTP and selected jobs application (#652)', () => {
  it(
    'serves validated orders and runs selected jobs under one installed application lifecycle',
    async () => {
      const report = await journey();
      expect(report.installed).toEqual({
        directDependencies: ['@zmdb/core', '@zmdb/jobs', '@zmdb/jobs-sqlite'],
        typecheck: 0,
        workspaceLinks: [],
      });
      expect(report.invalid).toEqual({ status: 400, orders: 0, jobs: 0 });
      expect(report.valid).toEqual({
        status: 200,
        entity: { id: 1, name: 'first order' },
        stored: [{ id: 1, name: 'first order' }],
        delivered: [{ orderId: 1, name: 'first order' }],
        completedJobs: 1,
      });
      expect(report.lifecycle).toEqual({
        initialized: 1,
        shutdowns: 1,
        listenerClosed: true,
        portRebound: true,
        databaseClosed: true,
        storeClosed: true,
      });
      expect(report.failures).toEqual([]);
      expect(report.cleaned).toBe(true);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
