import { describe, expect, it } from 'vitest';

import { mysqlDialect, postgresDialect, sqliteDialect } from '../testing/official-dialects.fixture.js';
import { jobPendingIndexDdl } from './index.js';

describe('queue job schema', () => {
  it.each([
    [
      postgresDialect,
      'postgres',
      `CREATE INDEX "zmdb_job_pending" ON "zmdb_job" ("status", "lease_until", "enqueued_at") WHERE status = 'pending'`,
    ],
    [
      sqliteDialect,
      'sqlite',
      `CREATE INDEX "zmdb_job_pending" ON "zmdb_job" ("status", "lease_until", "enqueued_at") WHERE status = 'pending'`,
    ],
    [mysqlDialect, 'mysql', 'CREATE INDEX `zmdb_job_pending` ON `zmdb_job` (`status`, `lease_until`, `enqueued_at`)'],
  ] as const)('emits the pending index for $name', (dialect, _name, expected) => {
    expect(jobPendingIndexDdl(dialect)).toBe(expected);
  });
});
