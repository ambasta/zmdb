import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const required = process.env.ZMDB_SINGLESTORE_REQUIRED === '1';
const live = process.env.ZMDB_SINGLESTORE_URL === undefined && !required ? it.skip : it;

live('packed consumer runs CRUD and migrations against SingleStore', { timeout: 420_000 }, () => {
  if (process.env.ZMDB_SINGLESTORE_URL === undefined) {
    throw new Error('ZMDB_SINGLESTORE_URL is required; packed SingleStore acceptance is fail-closed');
  }
  const verifier = fileURLToPath(
    new URL('../../../fixtures/database-singlestore/verify-installed.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [verifier], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: process.env,
    encoding: 'utf8',
    timeout: 410_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('packed consumer runs CRUD and migrations against SingleStore');
});
