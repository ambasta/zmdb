// @zmdb/web/queues/backends/memory — supported ephemeral queue storage for tests.
import { DatabaseSync } from 'node:sqlite';

import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { jobPendingIndexDdl } from '@zmdb/repository/jobs';

import type { JobStore } from '../index.js';

const JOB_SCHEMA = `
CREATE TABLE zmdb_job (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  enqueued_at TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  last_error TEXT,
  dead_reason TEXT CHECK (
    dead_reason IS NULL OR dead_reason IN ('invalid-payload', 'unknown-name', 'attempts-exhausted')
  ),
  dead_detail TEXT,
  dead_at TEXT
);

CREATE TABLE zmdb_job_done (
  key TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);
`;

/** An isolated SQLite queue store. Its database is exposed for deterministic test setup and assertions. */
export interface MemoryJobStore extends JobStore, Disposable {
  readonly dialect: 'sqlite';
  readonly database: DatabaseSync;
  close(): void;
}

/**
 * Create an ephemeral queue backend with the durable queue schema already installed.
 *
 * The store is intentionally process-local and non-persistent. Use it for tests and
 * local execution; production persistence belongs on a durable JobStore such as the
 * optional `pg` adapter.
 */
export function createMemoryJobStore(): MemoryJobStore {
  const database = new DatabaseSync(':memory:');
  database.exec(JOB_SCHEMA);
  database.exec(jobPendingIndexDdl('sqlite'));
  const driver = sqliteDriver(database);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    database.close();
  };

  return {
    dialect: 'sqlite',
    database,
    execute: query => driver.execute(query),
    close,
    [Symbol.dispose]: close,
  };
}
