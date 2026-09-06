import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = join(import.meta.dirname, '../../..');

describe('@zmdb/angular packed consumers', () => {
  it(
    'installs published tarballs and runs browser, SSR, and common conformance without workspace paths',
    () => {
      const result = spawnSync(
        process.execPath,
        [
          `--import=${join(ROOT, 'scripts', 'ts-specifier-hook.mjs')}`,
          join(ROOT, 'fixtures', 'client-adapters', 'angular', 'verify-packed.mjs'),
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          timeout: PACKED_BUILD_TEST_TIMEOUT_MS,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(
        'Angular packed consumers passed: 2 tarballs, 11 common cases, browser lifecycle, request-local SSR.',
      );
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
