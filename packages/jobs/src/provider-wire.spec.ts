import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { expect, it } from 'vitest';

import { withPackedBuildLock } from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = resolve(import.meta.dirname, '../../..');

it('runs the portable and real-provider method and wiring contracts from installed tarballs', () => {
  const evidence = mkdtempSync(join(dirname(ROOT), 'jobs-wire-evidence-'));
  const report = join(evidence, 'result.json');
  try {
    const result = withPackedBuildLock(ROOT, () =>
      spawnSync(process.execPath, [join(ROOT, 'fixtures/consumer-jobs-providers/qualify.mjs'), '--root', ROOT], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ZMDB_JOBS_EVIDENCE: report },
      }),
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const observed = JSON.parse(readFileSync(report, 'utf8')) as {
      cleaned: boolean;
      runtime: string;
      failures: unknown[];
    };
    expect(observed.failures).toEqual([]);
    expect(observed.cleaned).toBe(true);
    expect(existsSync(observed.runtime)).toBe(false);
  } finally {
    rmSync(evidence, { recursive: true });
  }
}, 1_200_000);

it.each(['consumer', 'timeout'])(
  'qualification releases its real registry and cluster after a %s failure',
  failureMode => {
    const evidence = mkdtempSync(join(dirname(ROOT), 'jobs-failure-evidence-'));
    const report = join(evidence, 'result.json');
    try {
      const result = withPackedBuildLock(ROOT, () =>
        spawnSync(
          process.execPath,
          [join(ROOT, 'fixtures/consumer-jobs-providers/qualify.mjs'), '--root', ROOT, '--failure-mode', failureMode],
          {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 600_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, ZMDB_JOBS_EVIDENCE: report },
          },
        ),
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
      const observed = JSON.parse(readFileSync(report, 'utf8')) as {
        cleaned: boolean;
        runtime: string;
        injectedFailure: string;
        postgresPid: number;
        failures: { name: string; error: string }[];
      };
      expect(observed.injectedFailure).toBe(failureMode);
      expect(observed.failures).toHaveLength(1);
      expect(observed.failures[0]).toMatchObject({
        name: expect.stringMatching(/(?:postgres|sqlite) packed provider workflow/),
        error: expect.stringContaining(`injected consumer ${failureMode === 'consumer' ? 'failure' : 'timeout'}`),
      });
      expect(observed.cleaned).toBe(true);
      expect(existsSync(observed.runtime)).toBe(false);
      if (observed.postgresPid !== undefined) {
        expect(() => process.kill(observed.postgresPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
      }
    } finally {
      rmSync(evidence, { recursive: true });
    }
  },
  1_200_000,
);
