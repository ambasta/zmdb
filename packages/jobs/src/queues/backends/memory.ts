// @zmdb/jobs/memory — supported ephemeral queue storage for tests and local execution.
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';

import { jobPendingIndexDdl } from '@zmdb/repository/jobs';
import type { SqliteDatabase } from '@zmdb/sqlite/node';

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
  readonly database: NodeDatabaseSync;
  close(): void;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Create an ephemeral queue backend with the durable queue schema already installed.
 *
 * The store is intentionally process-local and non-persistent. Use it for tests and
 * local execution; production persistence belongs on a separately installed durable
 * JobStore implementation.
 */
export function createMemoryJobStore(): MemoryJobStore {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const database = new DatabaseSync(':memory:') satisfies SqliteDatabase;
  const executionDatabase: SqliteDatabase = database;
  database.exec(JOB_SCHEMA);
  database.exec(jobPendingIndexDdl('sqlite'));
  let closed = false;

  // JobStore needs only the execution subset. Keeping it local prevents the
  // default product root from evaluating SQLite migration and introspection code.
  const execute: JobStore['execute'] = async query => {
    const statement = executionDatabase.prepare(query.text);
    const parameters = query.parameters.map(value => (value instanceof Date ? value.toISOString() : value));
    const columns = statement.columns?.();
    const isRead =
      columns === undefined
        ? /^\s*(?:SELECT|PRAGMA)\b/i.test(query.text) || /RETURNING/i.test(query.text)
        : columns.length > 0;
    if (isRead) {
      const rows = statement.all(...parameters);
      if (!rows.every(isRow)) throw new TypeError('node:sqlite returned a non-record row');
      return rows;
    }
    statement.run(...parameters);
    return [];
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    database.close();
  };

  return {
    dialect: 'sqlite',
    database,
    execute,
    close,
    [Symbol.dispose]: close,
  };
}
