import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

const qualifier = fileURLToPath(
  new URL('../../../fixtures/consumer-database-publication/qualify.mjs', import.meta.url),
);

it(
  'packed sqlite consumer runs with Node built-ins only',
  () => {
    expect(existsSync(qualifier), 'the database publication qualifier must exist').toBe(true);
    const result = spawnSync(process.execPath, [qualifier, '--database', 'sqlite'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: PACKED_BUILD_TEST_TIMEOUT_MS,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('"database":"sqlite"');
    expect(result.stdout).toContain('"cleaned":true');
  },
  PACKED_BUILD_TEST_TIMEOUT_MS + 10_000,
);
