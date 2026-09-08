import assert from 'node:assert/strict';

import { createQueue, type JobEnqueue, type JobStore } from '@zmdb/jobs';

const enqueued: JobEnqueue[] = [];
const store: JobStore = {
  enqueue: job => {
    enqueued.push(job);
    return Promise.resolve({ kind: 'inserted', jobId: job.id });
  },
  candidates: () => Promise.resolve([]),
  claim: () => Promise.resolve([]),
  completed: () => Promise.resolve(false),
  settle: () => Promise.resolve(false),
  listDead: () => Promise.resolve([]),
  replay: () => Promise.resolve(false),
};
const queue = createQueue<{ echo: { value: string } }>({
  store,
  clock: { now: () => 1000, sleep: () => Promise.resolve() },
});
const id = await queue.enqueue('echo', { value: 'wire-π' }, { delayMs: 25, dedupeKey: 'release' });
assert.equal(enqueued[0]?.id, id);
assert.equal(enqueued[0]?.name, 'echo');
assert.equal(enqueued[0]?.payload, '{"value":"wire-π"}');
assert.equal(enqueued[0]?.availableAt.getTime(), 1025);
assert.equal(enqueued[0]?.dedupeKey, 'release');
