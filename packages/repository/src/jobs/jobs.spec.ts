import { describe, expect, it } from 'vitest';

import { jobPendingIndexDdl } from './index.js';

describe('queue job schema', () => {
  it.each([
    [
      'postgres',
      `CREATE INDEX "zmdb_job_pending" ON "zmdb_job" ("status", "lease_until", "enqueued_at") WHERE status = 'pending'`,
    ],
    [
      'sqlite',
      `CREATE INDEX "zmdb_job_pending" ON "zmdb_job" ("status", "lease_until", "enqueued_at") WHERE status = 'pending'`,
    ],
    ['mysql', 'CREATE INDEX `zmdb_job_pending` ON `zmdb_job` (`status`, `lease_until`, `enqueued_at`)'],
  ] as const)('emits the pending index for %s', (dialect, expected) => {
    expect(jobPendingIndexDdl(dialect)).toBe(expected);
  });
});
