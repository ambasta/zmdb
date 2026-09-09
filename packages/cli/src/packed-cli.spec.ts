// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixture, type ConsumerFixture } from '../../../fixtures/consumer-cli/registry.mjs';

let fixture: ConsumerFixture;

beforeAll(async () => {
  fixture = await createFixture();
}, 120_000);

afterAll(async () => {
  await fixture.cleanup();
}, 30_000);

describe('installed CLI', () => {
  it('runs the packed executable', async () => {
    const consumer = await fixture.install('cli-smoke', ['@zmdb/cli']);
    const stdout = execFileSync(join(consumer, 'node_modules', '.bin', 'zmdb'), ['--version'], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(stdout).toMatch(/^zmdb \S+\n$/);
  }, 60_000);
});
