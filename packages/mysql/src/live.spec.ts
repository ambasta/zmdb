import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const live = process.env.ZMDB_MYSQL_URL === undefined ? it.skip : it;

live('packed consumer runs against strict utf8mb4 MySQL', { timeout: 300_000 }, () => {
  const verifier = fileURLToPath(new URL('../../../fixtures/database-mysql/verify-installed.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [verifier], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: process.env,
    encoding: 'utf8',
    timeout: 290_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('packed consumer runs against strict utf8mb4 MySQL');
});
