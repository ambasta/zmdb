// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const live = process.env.ZMDB_MSSQL_URL === undefined ? it.skip : it;

live('packed consumer applies migrations and CRUD against SQL Server', { timeout: 300_000 }, () => {
  const verifier = fileURLToPath(new URL('../../../fixtures/database-mssql/verify-installed.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [verifier], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: process.env,
    encoding: 'utf8',
    timeout: 290_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('packed consumer applies migrations and CRUD against SQL Server');
});
