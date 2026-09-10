// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { startFixtures } from '../../../../../fixtures/consumer-transport-sqs/broker.mjs';
import { exerciseBroker } from '../../../../../fixtures/consumer-transport-sqs/runtime.mjs';
import { exerciseWire } from '../../../../../fixtures/consumer-transport-sqs/wire.mjs';

let fixtures: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fixtures = await startFixtures();
}, 60_000);
afterAll(async () => {
  if (fixtures) await fixtures.stop();
}, 30_000);

it('delivers, retries, dead-letters and restarts through the real AWS SDK and isolated SQS-compatible broker', async () => {
  const { createSqsStrategy } = await import(pathToFileURL(`${import.meta.dirname}/../index.ts`).href);
  expect(await exerciseBroker(createSqsStrategy, fixtures.endpoint)).toEqual({
    emitted: true,
    redelivered: true,
    deadLetters: 2,
    restarted: true,
    callerClientUsable: true,
  });
}, 30_000);

it('uses actual SDK HTTP failures and never deletes the source after an unconfirmed dead-letter send', async () => {
  const { createSqsStrategy } = await import(pathToFileURL(`${import.meta.dirname}/../index.ts`).href);
  expect(await exerciseWire(createSqsStrategy, fixtures.wire)).toEqual({
    realSdkError: true,
    sourceDeleteAbsent: true,
    exactWireBody: true,
    pendingPollAborted: true,
  });
}, 15_000);
