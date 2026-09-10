// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../../..');

it('installs Kafka and dispatches through a real broker with ordered settlement and restart replay', async () => {
  const runner = join(root, 'fixtures/consumer-transport-kafka/verify-installed.mjs');
  expect(existsSync(runner), 'the real installed Kafka qualifier must exist').toBe(true);
  const evidence = await mkdtemp(resolve(root, '../kafka-installed-proof-'));
  try {
    await execute(process.execPath, [runner, '--evidence', evidence], {
      cwd: root,
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const report = JSON.parse(await readFile(join(evidence, 'result.json'), 'utf8'));
    expect(report.cleaned).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.installed).toMatchObject({
      roots: ['@zmdb/app', '@zmdb/transport/kafka', 'kafkajs'],
      npmCi: true,
      typecheck: true,
      privateEntriesRefused: 2,
    });
    expect(report.wire).toEqual({
      beforeRetry: '1',
      afterSettlement: '5',
      afterReplay: '6',
      retryAttempts: [1, 2],
      deadLetters: 2,
      restartAttempts: [1],
      appValidation: true,
      callerResourcesUsable: true,
    });
  } finally {
    await rm(evidence, { recursive: true, force: true });
  }
}, 250000);
