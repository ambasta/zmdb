// Compile-time half of #587/#588. Assertions stay against the shipped surface.
import type { Client, Pool, PoolClient } from 'pg';

import { createMemoryJobStore } from './backends/memory.js';
import { createPgJobStore } from './backends/pg.js';
import { createQueue } from './index.js';
import type { AnyJobHandler, Backoff, Clock, JobHandler, JobStore } from './index.js';

type Jobs = {
  readonly 'post.notify': { readonly postId: string };
  readonly 'user.audit': { readonly userId: number };
};

declare const store: JobStore;
declare const clock: Clock;
declare const pool: Pool;
declare const poolClient: PoolClient;
declare const client: Client;
const queue = createQueue<Jobs>({ store, clock });

export const memoryStore: JobStore = createMemoryJobStore();
export const poolStore: JobStore = createPgJobStore(pool);
export const poolClientStore: JobStore = createPgJobStore(poolClient);
export const clientStore: JobStore = createPgJobStore(client, { prepared: true, maxCacheSize: 32 });
// @ts-expect-error - the pg adapter requires a node-postgres client rather than an arbitrary JobStore.
export const notPg = createPgJobStore(store);

export function disposableMemoryStore(): void {
  using memory = createMemoryJobStore();
  void memory.database;
}

export const notify: AnyJobHandler<Jobs> = {
  name: 'post.notify',
  validate: () => ({ postId: 'p1' }),
  handle: () => Promise.resolve(),
};

// The broad form accepts this mismatch, which is why AnyJobHandler is mapped by key.
export const broadAcceptsMismatch: readonly JobHandler<Jobs, keyof Jobs & string>[] = [
  {
    name: 'post.notify',
    validate: () => ({ userId: 1 }),
    handle: () => Promise.resolve(),
  },
];

// @ts-expect-error - the name and payload must come from the same row of Jobs.
export const mappedRejectsMismatch: AnyJobHandler<Jobs> = {
  name: 'post.notify',
  validate: () => ({ userId: 1 }),
  handle: () => Promise.resolve(),
};

void queue.enqueue('post.notify', { postId: 'p1' });
// @ts-expect-error - user.audit's payload cannot be sent to post.notify.
void queue.enqueue('post.notify', { userId: 1 });
// @ts-expect-error - an unknown job name is not a key of Jobs.
void queue.enqueue('missing', { postId: 'p1' });

export const fixed: Backoff = { kind: 'fixed', delayMs: 1000 };
// @ts-expect-error - ceilingMs exists only on exponential backoff.
export const fixedWithCeiling: Backoff = { kind: 'fixed', delayMs: 1000, ceilingMs: 5000 };
