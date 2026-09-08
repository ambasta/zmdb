import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

const qualifier = fileURLToPath(
  new URL('../../../fixtures/consumer-database-publication/qualify.mjs', import.meta.url),
);
const cases = [
  ['sqlite', 'packed sqlite consumer runs with Node built-ins only'],
  ['postgres', 'packed postgres consumer runs through pg'],
  ['mysql', 'packed mysql consumer runs through mysql2'],
  ['mssql', 'packed mssql consumer runs through node-mssql'],
  ['cockroach', 'packed cockroach consumer uses the PostgreSQL family dependency'],
  ['singlestore', 'packed singlestore consumer uses the MySQL family dependency'],
] as const;
let batch: SpawnSyncReturns<string> | undefined;

for (const [database, title] of cases) {
  it(
    title,
    () => {
      expect(existsSync(qualifier), 'the executable six-database publication qualifier must exist').toBe(true);
      const result = (batch ??= spawnSync(process.execPath, [qualifier, '--all'], {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        timeout: PACKED_BUILD_TEST_TIMEOUT_MS,
      }));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`"database":"${database}"`);
      expect(result.stdout).toContain('"cleaned":true');
    },
    PACKED_BUILD_TEST_TIMEOUT_MS + 10_000,
  );
}
