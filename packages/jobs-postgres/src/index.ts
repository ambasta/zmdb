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
import { postgresDriver, type PgQueryable } from '@zmdb/postgres';
import type { Client, Pool, PoolClient } from 'pg';

export type PgJobClient = Pool | PoolClient | Client;
export type PgJobTransactionClient = PoolClient | Client;
export interface PgJobStore extends JobStore, LeaseStore, JobStoreResource {}
export interface PgJobStoreOptions {
  readonly prepared?: boolean;
  readonly maxCacheSize?: number;
  readonly cancelVia?: PgJobClient;
  readonly signal?: AbortSignal;
  readonly operationTimeoutMs?: number;
}

export const jobsPostgresMigrations: readonly JobStoreMigration[] = Object.freeze([
  Object.freeze({
    version: 20260906000100,
    name: 'jobs_queue',
    up: `CREATE TABLE zmdb_job (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2147483647),
      enqueued_at TIMESTAMPTZ NOT NULL, dedupe_key TEXT UNIQUE,
      lease_owner TEXT NOT NULL DEFAULT '', lease_until TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      last_error TEXT, dead_reason TEXT CHECK (dead_reason IN ('invalid-payload', 'unknown-name', 'attempts-exhausted')),
      dead_detail TEXT, dead_at TIMESTAMPTZ
    );
    CREATE TABLE zmdb_job_done (key TEXT PRIMARY KEY NOT NULL, completed_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX zmdb_job_pending ON zmdb_job(status, lease_until, enqueued_at) WHERE status = 'pending';
    CREATE INDEX zmdb_job_lease_expiry ON zmdb_job(lease_until) WHERE status = 'pending';
    CREATE INDEX zmdb_job_dead ON zmdb_job(dead_at) WHERE status = 'dead';`,
    down: 'DROP INDEX zmdb_job_dead; DROP INDEX zmdb_job_lease_expiry; DROP INDEX zmdb_job_pending; DROP TABLE zmdb_job_done; DROP TABLE zmdb_job;',
  }),
  Object.freeze({
    version: 20260906000200,
    name: 'jobs_schedule_lease',
    up: `CREATE TABLE zmdb_job_lease (key TEXT PRIMARY KEY NOT NULL, holder TEXT NOT NULL CHECK (holder <> ''), expires_at TIMESTAMPTZ NOT NULL);
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
  return { id: text(row, 'id'), name: text(row, 'name'), enqueuedAt: date(row, 'enqueued_at') };
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
function date(row: Record<string, unknown>, key: string): Date {
  const value = row[key];
  return value instanceof Date ? value : new Date(text(row, key));
}
type Rows = (sql: string, parameters?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
async function enqueue(rows: Rows, job: JobEnqueue): Promise<JobEnqueueResult> {
  string('id', job.id);
  string('name', job.name);
  string('payload', job.payload, true);
  if (job.dedupeKey !== undefined) string('dedupeKey', job.dedupeKey);
  const enqueuedAt = timestamp(job.enqueuedAt),
    availableAt = timestamp(job.availableAt);
  const inserted = await rows(
    `INSERT INTO zmdb_job (id, name, payload, enqueued_at, dedupe_key, lease_until)
    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    [job.id, job.name, job.payload, enqueuedAt, job.dedupeKey ?? null, availableAt],
  );
  if (inserted.length > 0) return { kind: 'inserted', jobId: job.id };
  const existing = (await rows('SELECT id FROM zmdb_job WHERE dedupe_key = $1', [job.dedupeKey]))[0];
  if (existing === undefined) throw new Error('@zmdb/jobs-postgres: dedupe row is missing');
  return { kind: 'duplicate', jobId: text(existing, 'id') };
}

function isPool(client: PgJobClient): client is Pool {
  return 'totalCount' in client && 'idleCount' in client;
}
const connectionTails = new WeakMap<PgJobTransactionClient, Promise<void>>();
interface PreparedState {
  readonly names: Map<string, string>;
  sequence: number;
  readonly namespace: string;
}
const preparedStates = new WeakMap<PgJobTransactionClient, PreparedState>();

function preparedConnection(
  connection: PgJobTransactionClient,
  options: PgJobStoreOptions,
  signal: AbortSignal,
): PgQueryable {
  return {
    async query(
      query:
        | string
        | {
            readonly name?: string;
            readonly queryMode?: 'extended';
            readonly text: string;
            readonly values?: readonly unknown[];
          },
      parameters?: readonly unknown[],
    ) {
      signal.throwIfAborted();
      if (typeof query !== 'string') return connection.query({ ...query, values: [...(query.values ?? [])] });
      if (!options.prepared || query === 'SELECT pg_backend_pid() AS pid')
        return connection.query(query, [...(parameters ?? [])]);
      let state = preparedStates.get(connection);
      if (state === undefined) {
        state = {
          names: new Map(),
          sequence: 0,
          namespace: `zmdb_jobs_${globalThis.crypto.randomUUID().replaceAll('-', '')}`,
        };
        preparedStates.set(connection, state);
      }
      const maximum = options.maxCacheSize ?? 1000;
      let name = state.names.get(query);
      const desired = maximum - (maximum > 0 && name === undefined ? 1 : 0);
      while (state.names.size > desired) {
        const oldest = [...state.names.entries()].find(([sql]) => maximum === 0 || sql !== query);
        if (oldest === undefined) break;
        const present = await connection.query('SELECT name FROM pg_prepared_statements WHERE name = $1', [oldest[1]]);
        signal.throwIfAborted();
        if (present.rows.length > 0) await connection.query(`DEALLOCATE ${oldest[1]}`);
        state.names.delete(oldest[0]);
        signal.throwIfAborted();
      }
      if (maximum === 0) {
        signal.throwIfAborted();
        const unnamed = { queryMode: 'extended', text: query, values: [...(parameters ?? [])] };
        return connection.query(unnamed);
      }
      name ??= `${state.namespace}_${(state.sequence++).toString(36)}`;
      state.names.delete(query);
      state.names.set(query, name);
      return connection.query({ name, text: query, values: [...(parameters ?? [])] });
    },
  };
}

class Operations {
  readonly #client: PgJobClient;
  readonly #options: PgJobStoreOptions;
  readonly #timeoutMs: number;
  readonly #shutdown = new AbortController();
  readonly #active = new Set<Promise<unknown>>();
  readonly #cleanupErrors: unknown[] = [];
  #closed = false;
  #closing: Promise<void> | undefined;
  constructor(client: PgJobClient, options?: PgJobStoreOptions) {
    this.#client = client;
    this.#options = options ?? {};
    this.#timeoutMs = options?.operationTimeoutMs ?? 30_000;
    integer('operationTimeoutMs', this.#timeoutMs, 1);
    if (options?.maxCacheSize !== undefined) integer('maxCacheSize', options.maxCacheSize, 0, Number.MAX_SAFE_INTEGER);
  }
  run<T>(transaction: boolean, body: (rows: Rows) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('@zmdb/jobs-postgres: store is closed'));
    if (this.#options.signal?.aborted) return Promise.reject(this.#options.signal.reason);
    const deadline = new AbortController();
    const signal = AbortSignal.any([
      deadline.signal,
      this.#shutdown.signal,
      ...(this.#options.signal === undefined ? [] : [this.#options.signal]),
    ]);
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DOMException(
            '@zmdb/jobs-postgres: operation deadline exceeded; database outcome may be incomplete',
            'TimeoutError',
          ),
        ),
      this.#timeoutMs,
    );
    const client = this.#client;
    const previous = isPool(client) ? undefined : connectionTails.get(client);
    const actual = Promise.resolve().then(async () => {
      if (previous !== undefined) await previous;
      signal.throwIfAborted();
      let connection: PgJobTransactionClient | undefined;
      let acquired = false,
        began = false,
        failed = false;
      let rollbackError: Error | undefined;
      let failure: unknown;
      let result: { readonly value: T } | undefined;
      try {
        if (isPool(client)) {
          connection = await client.connect();
          acquired = true;
        } else connection = client;
        signal.throwIfAborted();
        const selected = postgresDriver(
          preparedConnection(connection, this.#options, signal),
          this.#options.cancelVia === undefined ? {} : { cancelVia: this.#options.cancelVia },
        );
        const rows: Rows = (sql, parameters = []) => selected.execute({ text: sql, parameters }, { signal });
        if (transaction) {
          await connection.query('BEGIN');
          began = true;
        }
        signal.throwIfAborted();
        result = { value: await body(rows) };
        signal.throwIfAborted();
        if (began) {
          await connection.query('COMMIT');
          began = false;
        }
        signal.throwIfAborted();
      } catch (error) {
        failed = true;
        failure = error;
        if (began && connection !== undefined) {
          try {
            await connection.query('ROLLBACK');
          } catch (rollback) {
            failure = new AggregateError([error, rollback], '@zmdb/jobs-postgres: rollback failed');
            rollbackError =
              rollback instanceof Error
                ? rollback
                : new Error('@zmdb/jobs-postgres: rollback failed', { cause: rollback });
            if (signal.aborted) this.#cleanupErrors.push(rollback);
          }
        }
      } finally {
        if (acquired && connection !== undefined && 'release' in connection) {
          try {
            connection.release(rollbackError);
          } catch (release) {
            failure = failed ? new AggregateError([failure, release], '@zmdb/jobs-postgres: release failed') : release;
            failed = true;
            this.#cleanupErrors.push(release);
          }
        }
      }
      if (failed) throw failure;
      if (result === undefined) throw new Error('@zmdb/jobs-postgres: operation did not produce a result');
      return result.value;
    });
    // The serial slot belongs to actual SQL and cleanup, even after the caller's deadline expires.
    if (!isPool(client))
      connectionTails.set(
        client,
        actual.then(
          () => undefined,
          () => undefined,
        ),
      );
    this.#active.add(actual);
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    void actual.then(
      () => this.#finished(actual, timer, signal, onAbort),
      () => this.#finished(actual, timer, signal, onAbort),
    );
    return Promise.race([actual, aborted]);
  }
  #finished(
    actual: Promise<unknown>,
    timer: ReturnType<typeof setTimeout>,
    signal: AbortSignal,
    onAbort: () => void,
  ): void {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    this.#active.delete(actual);
  }
  close(options?: { readonly graceMs: number }): Promise<void> {
    if (options !== undefined) integer('graceMs', options.graceMs, 0);
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#shutdown.abort(new DOMException('@zmdb/jobs-postgres: store is closed', 'AbortError'));
    const graceMs = Math.min(options?.graceMs ?? this.#timeoutMs, this.#timeoutMs);
    this.#closing = this.#drain(graceMs);
    return this.#closing;
  }
  async #drain(graceMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(this.#active),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DOMException('@zmdb/jobs-postgres: shutdown deadline exceeded; cleanup incomplete', 'TimeoutError'),
              ),
            graceMs,
          );
        }),
      ]);
      if (this.#cleanupErrors.length === 1) throw this.#cleanupErrors[0];
      if (this.#cleanupErrors.length > 1)
        throw new AggregateError(this.#cleanupErrors, '@zmdb/jobs-postgres: cleanup failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateEnqueue(job: JobEnqueue): void {
  string('id', job.id);
  string('name', job.name);
  string('payload', job.payload, true);
  if (job.dedupeKey !== undefined) string('dedupeKey', job.dedupeKey);
  timestamp(job.enqueuedAt);
  timestamp(job.availableAt);
}
class PgStore implements PgJobStore {
  readonly #operations: Operations;
  constructor(client: PgJobClient, options?: PgJobStoreOptions) {
    this.#operations = new Operations(client, options);
  }
  async enqueue(job: JobEnqueue): Promise<JobEnqueueResult> {
    validateEnqueue(job);
    return this.#operations.run(true, rows => enqueue(rows, job));
  }
  async candidates(options: { readonly now: Date; readonly limit: number }): Promise<readonly JobCandidate[]> {
    integer('limit', options.limit, 1);
    const now = timestamp(options.now);
    return this.#operations.run(true, async rows =>
      (
        await rows(
          'SELECT id, name, enqueued_at FROM zmdb_job WHERE status = \'pending\' AND lease_until <= $1 ORDER BY enqueued_at, id COLLATE "C" LIMIT $2',
          [now, options.limit],
        )
      ).map(candidate),
    );
  }
  async claim(options: {
    readonly ids: readonly string[];
    readonly holder: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }): Promise<readonly ClaimedJob[]> {
    string('holder', options.holder);
    const now = timestamp(options.now),
      until = timestamp(options.leaseUntil);
    if (options.leaseUntil.getTime() <= options.now.getTime())
      throw new RangeError('leaseUntil must be later than now');
    for (const id of options.ids) string('id', id);
    const ids = [...new Set(options.ids)];
    return this.#operations.run(true, async rows => {
      if (ids.length === 0) return [];
      return (
        await rows(
          `WITH claimed AS (
        UPDATE zmdb_job SET lease_owner = $1, lease_until = $2
        WHERE id = ANY($3::text[]) AND status = 'pending' AND lease_until <= $4 RETURNING *
      ) SELECT * FROM claimed ORDER BY enqueued_at, id COLLATE "C"`,
          [options.holder, until, ids, now],
        )
      ).map(claimed);
    });
  }
  async completed(key: string): Promise<boolean> {
    string('key', key);
    return this.#operations.run(
      true,
      async rows => (await rows('SELECT key FROM zmdb_job_done WHERE key = $1', [key])).length > 0,
    );
  }
  async settle(settlement: JobSettlement): Promise<boolean> {
    string('jobId', settlement.jobId);
    string('holder', settlement.holder);
    let sql: string, parameters: readonly unknown[];
    switch (settlement.kind) {
      case 'done':
        string('idempotencyKey', settlement.idempotencyKey);
        sql =
          "UPDATE zmdb_job SET status = 'done', attempts = attempts + 1, lease_owner = '', lease_until = $1, last_error = NULL, dead_reason = NULL, dead_detail = NULL, dead_at = NULL";
        parameters = [timestamp(settlement.completedAt)];
        break;
      case 'retry':
        integer('attempts', settlement.attempts, 0);
        string('detail', settlement.detail, true);
        sql =
          "UPDATE zmdb_job SET attempts = $1, lease_owner = '', lease_until = $2, last_error = $3, dead_reason = NULL, dead_detail = NULL, dead_at = NULL";
        parameters = [settlement.attempts, timestamp(settlement.availableAt), settlement.detail];
        break;
      case 'dead':
        integer('attempts', settlement.attempts, 0);
        string('detail', settlement.detail, true);
        reason(settlement.reason);
        sql =
          "UPDATE zmdb_job SET status = 'dead', attempts = $1, lease_owner = '', lease_until = $2, last_error = $3, dead_reason = $4, dead_detail = $5, dead_at = $6";
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
        sql = "UPDATE zmdb_job SET lease_owner = '', lease_until = $1";
        parameters = [timestamp(settlement.availableAt)];
        break;
      default:
        throw new TypeError('unknown job settlement');
    }
    const fence = ` WHERE id = $${parameters.length + 1} AND lease_owner = $${parameters.length + 2} AND lease_owner <> '' AND status = 'pending' RETURNING id`;
    return this.#operations.run(true, async rows => {
      const changed = (await rows(sql + fence, [...parameters, settlement.jobId, settlement.holder])).length > 0;
      if (changed && settlement.kind === 'done')
        await rows(
          'INSERT INTO zmdb_job_done (key, completed_at) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING RETURNING key',
          [settlement.idempotencyKey, timestamp(settlement.completedAt)],
        );
      return changed;
    });
  }
  async listDead(options: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]> {
    integer('limit', options.limit, 1);
    if (options.reason !== undefined) reason(options.reason);
    return this.#operations.run(true, async rows =>
      (
        await rows(
          `SELECT * FROM zmdb_job WHERE status = 'dead'${options.reason === undefined ? '' : ' AND dead_reason = $2'} ORDER BY dead_at DESC, id COLLATE "C" LIMIT $1`,
          options.reason === undefined ? [options.limit] : [options.limit, options.reason],
        )
      ).map(row => ({
        jobId: text(row, 'id'),
        name: text(row, 'name'),
        payload: text(row, 'payload'),
        attempts: count(row),
        reason: reason(row['dead_reason']),
        detail: text(row, 'dead_detail'),
        enqueuedAt: date(row, 'enqueued_at'),
        deadAt: date(row, 'dead_at'),
      })),
    );
  }
  async replay(jobId: string, availableAt: Date): Promise<boolean> {
    string('jobId', jobId);
    const available = timestamp(availableAt);
    return this.#operations.run(
      true,
      async rows =>
        (
          await rows(
            "UPDATE zmdb_job SET status = 'pending', attempts = 0, lease_owner = '', lease_until = $1, last_error = NULL, dead_reason = NULL, dead_detail = NULL, dead_at = NULL WHERE id = $2 AND status = 'dead' RETURNING id",
            [available, jobId],
          )
        ).length > 0,
    );
  }
  async acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
    string('key', key);
    string('holder', holder);
    integer('ttlMs', ttlMs, 1);
    const now = Date.now();
    return this.#operations.run(
      true,
      async rows =>
        (
          await rows(
            `INSERT INTO zmdb_job_lease (key, holder, expires_at) VALUES ($1, $2, $3)
      ON CONFLICT(key) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
      WHERE zmdb_job_lease.holder = excluded.holder OR zmdb_job_lease.expires_at <= $4 RETURNING key`,
            [key, holder, timestamp(new Date(now + ttlMs)), timestamp(new Date(now))],
          )
        ).length > 0,
    );
  }
  async renew(key: string, holder: string, ttlMs: number): Promise<boolean> {
    string('key', key);
    string('holder', holder);
    integer('ttlMs', ttlMs, 1);
    const now = Date.now();
    return this.#operations.run(
      true,
      async rows =>
        (
          await rows(
            'UPDATE zmdb_job_lease SET expires_at = $1 WHERE key = $2 AND holder = $3 AND expires_at > $4 RETURNING key',
            [timestamp(new Date(now + ttlMs)), key, holder, timestamp(new Date(now))],
          )
        ).length > 0,
    );
  }
  async release(key: string, holder: string): Promise<void> {
    string('key', key);
    string('holder', holder);
    await this.#operations.run(true, rows =>
      rows('DELETE FROM zmdb_job_lease WHERE key = $1 AND holder = $2 RETURNING key', [key, holder]),
    );
  }
  close(options?: { readonly graceMs: number }): Promise<void> {
    return this.#operations.close(options);
  }
}

export function createPgJobStore(client: PgJobClient, options?: PgJobStoreOptions): PgJobStore {
  return new PgStore(client, options);
}
export function pgJobEnqueuer(client: PgJobTransactionClient, options?: PgJobStoreOptions): JobEnqueuer {
  if (isPool(client)) throw new TypeError('@zmdb/jobs-postgres: transaction enqueue requires a pinned client');
  const operations = new Operations(client, options);
  return {
    async enqueue(job) {
      validateEnqueue(job);
      return operations.run(false, rows => enqueue(rows, job));
    },
  };
}
