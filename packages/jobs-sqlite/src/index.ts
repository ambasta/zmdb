import { DatabaseSync } from 'node:sqlite';

import type {
  ClaimedJob,
  DeadJob,
  DeadReason,
  JobCandidate,
  JobEnqueue,
  JobEnqueuer,
  JobEnqueueResult,
  JobSettlement,
  JobStore,
  JobStoreMigration,
  JobStoreResource,
  LeaseStore,
} from '@zmdb/jobs';
import type { SqliteDatabase, SqliteStatement } from '@zmdb/sqlite';

export interface SqliteJobStore extends JobStore, LeaseStore, JobStoreResource {}
export interface SqliteJobStoreOptions {
  readonly maxCacheSize?: number;
}
export interface MemoryJobStore extends SqliteJobStore, Disposable {
  readonly database: DatabaseSync;
}

export const jobsSqliteMigrations: readonly JobStoreMigration[] = Object.freeze([
  Object.freeze({
    version: 20260906000100,
    name: 'jobs_queue',
    up: `CREATE TABLE zmdb_job (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2147483647),
      enqueued_at TEXT NOT NULL, dedupe_key TEXT UNIQUE,
      lease_owner TEXT NOT NULL DEFAULT '', lease_until TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      last_error TEXT, dead_reason TEXT CHECK (dead_reason IN ('invalid-payload', 'unknown-name', 'attempts-exhausted')),
      dead_detail TEXT, dead_at TEXT
    );
    CREATE TABLE zmdb_job_done (key TEXT PRIMARY KEY NOT NULL, completed_at TEXT NOT NULL);
    CREATE INDEX zmdb_job_pending ON zmdb_job(status, lease_until, enqueued_at) WHERE status = 'pending';
    CREATE INDEX zmdb_job_lease_expiry ON zmdb_job(lease_until) WHERE status = 'pending';
    CREATE INDEX zmdb_job_dead ON zmdb_job(dead_at) WHERE status = 'dead';`,
    down: 'DROP INDEX zmdb_job_dead; DROP INDEX zmdb_job_lease_expiry; DROP INDEX zmdb_job_pending; DROP TABLE zmdb_job_done; DROP TABLE zmdb_job;',
  }),
  Object.freeze({
    version: 20260906000200,
    name: 'jobs_schedule_lease',
    up: `CREATE TABLE zmdb_job_lease (key TEXT PRIMARY KEY NOT NULL, holder TEXT NOT NULL CHECK (holder <> ''), expires_at TEXT NOT NULL);
    CREATE INDEX zmdb_job_schedule_expiry ON zmdb_job_lease(expires_at);`,
    down: 'DROP INDEX zmdb_job_schedule_expiry; DROP TABLE zmdb_job_lease;',
  }),
]);

const MAX_INTEGER = 2_147_483_647;
function integer(name: string, value: number, minimum: number, maximum = MAX_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
}
function string(name: string, value: string, empty = false): void {
  if (typeof value !== 'string' || (!empty && value.length === 0) || value.includes('\0') || !value.isWellFormed()) {
    throw new TypeError(`${name} must be ${empty ? '' : 'nonempty '}Unicode text without NUL`);
  }
}
function timestamp(value: Date): string {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getTime() < -62_135_596_800_000 ||
    value.getTime() > 253_402_300_799_999
  )
    throw new RangeError('timestamp must be a finite Date between years 0001 and 9999');
  return value.toISOString();
}
function reason(value: unknown): DeadReason {
  if (value === 'invalid-payload' || value === 'unknown-name' || value === 'attempts-exhausted') return value;
  throw new TypeError('unknown dead-letter reason');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`zmdb_job.${key} must be text`);
  return value;
}
function count(row: Record<string, unknown>): number {
  const value = row['attempts'];
  if (typeof value !== 'number') throw new TypeError('zmdb_job.attempts must be a number');
  integer('attempts', value, 0);
  return value;
}
function candidate(row: Record<string, unknown>): JobCandidate {
  return { id: text(row, 'id'), name: text(row, 'name'), enqueuedAt: new Date(text(row, 'enqueued_at')) };
}
function claimed(row: Record<string, unknown>): ClaimedJob {
  return {
    ...candidate(row),
    payload: text(row, 'payload'),
    attempts: count(row),
    holder: text(row, 'lease_owner'),
    ...(row['dedupe_key'] === null ? {} : { dedupeKey: text(row, 'dedupe_key') }),
  };
}
type Rows = (sql: string, parameters?: readonly unknown[]) => readonly Record<string, unknown>[];
function enqueue(rows: Rows, job: JobEnqueue): JobEnqueueResult {
  validateEnqueue(job);
  const enqueuedAt = timestamp(job.enqueuedAt),
    availableAt = timestamp(job.availableAt);
  const inserted = rows(
    `INSERT INTO zmdb_job (id, name, payload, enqueued_at, dedupe_key, lease_until)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    [job.id, job.name, job.payload, enqueuedAt, job.dedupeKey ?? null, availableAt],
  );
  if (inserted.length > 0) return { kind: 'inserted', jobId: job.id };
  const existing = rows('SELECT id FROM zmdb_job WHERE dedupe_key = ?', [job.dedupeKey])[0];
  if (existing === undefined) throw new Error('@zmdb/jobs-sqlite: dedupe row is missing');
  return { kind: 'duplicate', jobId: text(existing, 'id') };
}
function validateEnqueue(job: JobEnqueue): void {
  string('id', job.id);
  string('name', job.name);
  string('payload', job.payload, true);
  if (job.dedupeKey !== undefined) string('dedupeKey', job.dedupeKey);
  timestamp(job.enqueuedAt);
  timestamp(job.availableAt);
}

class SqliteStore implements SqliteJobStore {
  readonly #database: SqliteDatabase;
  readonly #cache = new Map<string, SqliteStatement>();
  readonly #maxCacheSize: number;
  readonly #dispose: (() => void) | undefined;
  #closed = false;
  constructor(database: SqliteDatabase, options?: SqliteJobStoreOptions, dispose?: () => void) {
    this.#maxCacheSize = options?.maxCacheSize ?? 100;
    integer('maxCacheSize', this.#maxCacheSize, 0, Number.MAX_SAFE_INTEGER);
    this.#database = database;
    this.#dispose = dispose;
  }
  #open(): void {
    if (this.#closed) throw new Error('@zmdb/jobs-sqlite: store is closed');
  }
  #rows: Rows = (sql, parameters = []) => {
    this.#open();
    let statement = this.#cache.get(sql);
    this.#cache.delete(sql);
    statement ??= this.#database.prepare(sql);
    if (this.#maxCacheSize > 0) {
      this.#cache.set(sql, statement);
      if (this.#cache.size > this.#maxCacheSize) {
        const oldest = this.#cache.keys().next().value;
        if (oldest !== undefined) this.#cache.delete(oldest);
      }
    }
    return statement.all(...parameters).map(row => {
      if (!record(row)) throw new TypeError('@zmdb/jobs-sqlite: invalid database row');
      return row;
    });
  };
  #transaction<T>(body: () => T): T {
    this.#open();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = body();
      this.#database.exec('COMMIT');
      return result;
    } catch (primary) {
      try {
        this.#database.exec('ROLLBACK');
      } catch (rollback) {
        throw new AggregateError([primary, rollback], '@zmdb/jobs-sqlite: rollback failed', { cause: rollback });
      }
      throw primary;
    }
  }
  async enqueue(job: JobEnqueue): Promise<JobEnqueueResult> {
    validateEnqueue(job);
    return this.#transaction(() => enqueue(this.#rows, job));
  }
  async candidates(options: { readonly now: Date; readonly limit: number }): Promise<readonly JobCandidate[]> {
    integer('limit', options.limit, 1);
    return this.#rows(
      "SELECT id, name, enqueued_at FROM zmdb_job WHERE status = 'pending' AND lease_until <= ? ORDER BY enqueued_at, id COLLATE BINARY LIMIT ?",
      [timestamp(options.now), options.limit],
    ).map(candidate);
  }
  async claim(options: {
    readonly ids: readonly string[];
    readonly holder: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }): Promise<readonly ClaimedJob[]> {
    this.#open();
    string('holder', options.holder);
    const now = timestamp(options.now),
      until = timestamp(options.leaseUntil);
    if (options.leaseUntil.getTime() <= options.now.getTime())
      throw new RangeError('leaseUntil must be later than now');
    for (const id of options.ids) string('id', id);
    const ids = [...new Set(options.ids)];
    if (ids.length === 0) return [];
    return this.#transaction(() => {
      const rows = ids.flatMap(id =>
        this.#rows(
          "UPDATE zmdb_job SET lease_owner = ?, lease_until = ? WHERE id = ? AND status = 'pending' AND lease_until <= ? RETURNING *",
          [options.holder, until, id, now],
        ),
      );
      // SQLite's UTF-8 BINARY ordering is applied by the database to the claimed rows.
      return this.#rows(
        `SELECT * FROM zmdb_job WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'}) ORDER BY enqueued_at, id COLLATE BINARY`,
        rows.map(row => text(row, 'id')),
      ).map(claimed);
    });
  }
  async completed(key: string): Promise<boolean> {
    string('key', key);
    return this.#rows('SELECT key FROM zmdb_job_done WHERE key = ?', [key]).length > 0;
  }
  async settle(settlement: JobSettlement): Promise<boolean> {
    string('jobId', settlement.jobId);
    string('holder', settlement.holder);
    const fence = " WHERE id = ? AND lease_owner = ? AND lease_owner <> '' AND status = 'pending' RETURNING id";
    const identity = [settlement.jobId, settlement.holder];
    let sql: string, parameters: readonly unknown[];
    switch (settlement.kind) {
      case 'done':
        string('idempotencyKey', settlement.idempotencyKey);
        sql =
          "UPDATE zmdb_job SET status = 'done', attempts = attempts + 1, lease_owner = '', lease_until = ?, last_error = NULL, dead_reason = NULL, dead_detail = NULL, dead_at = NULL";
        parameters = [timestamp(settlement.completedAt)];
        break;
      case 'retry':
        integer('attempts', settlement.attempts, 0);
        string('detail', settlement.detail, true);
        sql =
          "UPDATE zmdb_job SET attempts = ?, lease_owner = '', lease_until = ?, last_error = ?, dead_reason = NULL, dead_detail = NULL, dead_at = NULL";
        parameters = [settlement.attempts, timestamp(settlement.availableAt), settlement.detail];
        break;
      case 'dead':
        integer('attempts', settlement.attempts, 0);
        string('detail', settlement.detail, true);
        reason(settlement.reason);
        sql =
          "UPDATE zmdb_job SET status = 'dead', attempts = ?, lease_owner = '', lease_until = ?, last_error = ?, dead_reason = ?, dead_detail = ?, dead_at = ?";
        parameters = [
          settlement.attempts,
          timestamp(settlement.deadAt),
          settlement.detail,
          settlement.reason,
          settlement.detail,
          timestamp(settlement.deadAt),
        ];
        break;
      case 'release':
        sql = "UPDATE zmdb_job SET lease_owner = '', lease_until = ?";
        parameters = [timestamp(settlement.availableAt)];
        break;
      default:
        throw new TypeError('unknown job settlement');
    }
    return this.#transaction(() => {
      const changed = this.#rows(sql + fence, [...parameters, ...identity]).length > 0;
      if (changed && settlement.kind === 'done')
        this.#rows(
          'INSERT INTO zmdb_job_done (key, completed_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING RETURNING key',
          [settlement.idempotencyKey, timestamp(settlement.completedAt)],
        );
      return changed;
    });
  }
  async listDead(options: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]> {
    integer('limit', options.limit, 1);
    if (options.reason !== undefined) reason(options.reason);
    return this.#rows(
      `SELECT * FROM zmdb_job WHERE status = 'dead'${options.reason === undefined ? '' : ' AND dead_reason = ?'} ORDER BY dead_at DESC, id COLLATE BINARY LIMIT ?`,
      options.reason === undefined ? [options.limit] : [options.reason, options.limit],
    ).map(row => ({
      jobId: text(row, 'id'),
      name: text(row, 'name'),
      payload: text(row, 'payload'),
      attempts: count(row),
      reason: reason(row['dead_reason']),
      detail: text(row, 'dead_detail'),
      enqueuedAt: new Date(text(row, 'enqueued_at')),
      deadAt: new Date(text(row, 'dead_at')),
    }));
  }
  async replay(jobId: string, availableAt: Date): Promise<boolean> {
    string('jobId', jobId);
    return (
      this.#rows(
        "UPDATE zmdb_job SET status = 'pending', attempts = 0, lease_owner = '', lease_until = ?, last_error = NULL, dead_reason = NULL, dead_detail = NULL, dead_at = NULL WHERE id = ? AND status = 'dead' RETURNING id",
        [timestamp(availableAt), jobId],
      ).length > 0
    );
  }
  async acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
    string('key', key);
    string('holder', holder);
    integer('ttlMs', ttlMs, 1);
    const now = Date.now();
    return (
      this.#rows(
        `INSERT INTO zmdb_job_lease (key, holder, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
      WHERE zmdb_job_lease.holder = excluded.holder OR zmdb_job_lease.expires_at <= ? RETURNING key`,
        [key, holder, timestamp(new Date(now + ttlMs)), timestamp(new Date(now))],
      ).length > 0
    );
  }
  async renew(key: string, holder: string, ttlMs: number): Promise<boolean> {
    string('key', key);
    string('holder', holder);
    integer('ttlMs', ttlMs, 1);
    const now = Date.now();
    return (
      this.#rows(
        'UPDATE zmdb_job_lease SET expires_at = ? WHERE key = ? AND holder = ? AND expires_at > ? RETURNING key',
        [timestamp(new Date(now + ttlMs)), key, holder, timestamp(new Date(now))],
      ).length > 0
    );
  }
  async release(key: string, holder: string): Promise<void> {
    string('key', key);
    string('holder', holder);
    this.#rows('DELETE FROM zmdb_job_lease WHERE key = ? AND holder = ? RETURNING key', [key, holder]);
  }
  close(options?: { readonly graceMs: number }): void {
    if (options !== undefined) integer('graceMs', options.graceMs, 0);
    if (this.#closed) return;
    this.#closed = true;
    this.#cache.clear();
    this.#dispose?.();
  }
}

export function createSqliteJobStore(database: SqliteDatabase, options?: SqliteJobStoreOptions): SqliteJobStore {
  return new SqliteStore(database, options);
}
class MemoryStore extends SqliteStore implements MemoryJobStore {
  readonly database: DatabaseSync;
  constructor(database: DatabaseSync, options?: SqliteJobStoreOptions) {
    super(database, options, () => database.close());
    this.database = database;
  }
  [Symbol.dispose](): void {
    this.close();
  }
}
export function createMemoryJobStore(options?: SqliteJobStoreOptions): MemoryJobStore {
  if (options?.maxCacheSize !== undefined) integer('maxCacheSize', options.maxCacheSize, 0, Number.MAX_SAFE_INTEGER);
  const database = new DatabaseSync(':memory:');
  try {
    for (const migration of jobsSqliteMigrations) database.exec(migration.up);
    return new MemoryStore(database, options);
  } catch (error) {
    database.close();
    throw error;
  }
}
export function sqliteJobEnqueuer(database: SqliteDatabase): JobEnqueuer {
  return {
    async enqueue(job) {
      return enqueue(
        (sql, parameters = []) =>
          database
            .prepare(sql)
            .all(...parameters)
            .map(row => {
              if (!record(row)) throw new TypeError('@zmdb/jobs-sqlite: invalid database row');
              return row;
            }),
        job,
      );
    },
  };
}
