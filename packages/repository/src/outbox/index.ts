import { createQueryCompiler } from '@zmdb/query-compiler';
import {
  outboxCandidatesQuery,
  outboxClaimQuery,
  outboxMarkDeadQuery,
  outboxMarkDeliveredQuery,
  outboxMarkRetryQuery,
  outboxReadBackQuery,
} from '@zmdb/query-compiler/outbox';
import type { CoreSchema } from '@zmdb/schema-core';
import { schemaFromIR } from '@zmdb/schema-core/ir';
import type { HasDefault, PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';

import type { Driver } from '../index.js';
import type { TransactionContext } from '../transactions/index.js';

export type OutboxStatus = 'pending' | 'delivered' | 'dead';

export interface OutboxRow extends Table<'zmdb_outbox'> {
  id: string & Sql<'text'> & PrimaryKey;
  topic: string & Sql<'text'>;
  payload: string & Sql<'text'>;
  status: OutboxStatus & Sql<'jsonEnum'> & HasDefault;
  attempts: number & Sql<'integer'> & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  leaseOwner: string & Sql<'text'> & HasDefault;
  leaseUntil: Date & Sql<'timestamp'> & HasDefault;
  deliveredAt: (Date & Sql<'timestamp'>) | null;
  lastError: (string & Sql<'text'>) | null;
}

const EMPTY_COLUMN = {
  primaryKey: false,
  serial: false,
  unique: false,
  sensitive: false,
  constraints: {},
  rules: [],
} as const;

/**
 * The built-in physical declaration applications include in schema snapshots.
 *
 * The public row type uses app-facing camelCase, while this value names the
 * snake_case columns emitted by `outboxMigration` and used by the dispatcher.
 */
export const OutboxSchema: CoreSchema<string> = schemaFromIR({
  table: 'zmdb_outbox',
  physicalTable: 'zmdb_outbox',
  primaryKey: ['id'],
  relations: [],
  columns: [
    {
      ...EMPTY_COLUMN,
      name: 'id',
      physicalName: 'id',
      sql: 'text',
      nullable: false,
      primaryKey: true,
      hasDefault: false,
    },
    {
      ...EMPTY_COLUMN,
      name: 'topic',
      physicalName: 'topic',
      sql: 'text',
      nullable: false,
      hasDefault: false,
    },
    {
      ...EMPTY_COLUMN,
      name: 'payload',
      physicalName: 'payload',
      sql: 'text',
      nullable: false,
      hasDefault: false,
    },
    {
      ...EMPTY_COLUMN,
      name: 'status',
      physicalName: 'status',
      sql: 'jsonEnum',
      nullable: false,
      hasDefault: true,
      enum: ['dead', 'delivered', 'pending'],
    },
    {
      ...EMPTY_COLUMN,
      name: 'attempts',
      physicalName: 'attempts',
      sql: 'integer',
      nullable: false,
      hasDefault: true,
    },
    {
      ...EMPTY_COLUMN,
      name: 'created_at',
      physicalName: 'created_at',
      sql: 'timestamp',
      nullable: false,
      hasDefault: true,
    },
    {
      ...EMPTY_COLUMN,
      name: 'lease_owner',
      physicalName: 'lease_owner',
      sql: 'text',
      nullable: false,
      hasDefault: true,
    },
    {
      ...EMPTY_COLUMN,
      name: 'lease_until',
      physicalName: 'lease_until',
      sql: 'timestamp',
      nullable: false,
      hasDefault: true,
    },
    {
      ...EMPTY_COLUMN,
      name: 'delivered_at',
      physicalName: 'delivered_at',
      sql: 'timestamp',
      nullable: true,
      hasDefault: false,
    },
    {
      ...EMPTY_COLUMN,
      name: 'last_error',
      physicalName: 'last_error',
      sql: 'text',
      nullable: true,
      hasDefault: false,
    },
  ],
});

export interface OutboxWriter {
  write(topic: string, payload: string): Promise<string>;
}

export function outboxWriter(tx: TransactionContext): OutboxWriter {
  const dialect = tx.dialect ?? 'postgres';
  return {
    async write(topic, payload) {
      const id = globalThis.crypto.randomUUID();
      await tx.execute(
        createQueryCompiler(dialect)
          .insertInto('zmdb_outbox')
          .values({
            id,
            topic,
            payload,
            status: 'pending',
            attempts: 0,
            created_at: new Date(),
            lease_owner: '',
            lease_until: new Date(0),
            delivered_at: null,
            last_error: null,
          })
          .compile(),
      );
      return id;
    },
  };
}

export interface DeadOutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface OutboxDispatcherOptions {
  readonly driver: Driver;
  readonly publish: (topic: string, payload: string) => Promise<void>;
  readonly batch?: number;
  readonly leaseMs?: number;
  readonly idleMs?: number;
  readonly maxIdleMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: (attempts: number) => number;
  readonly onDead?: (row: DeadOutboxRow) => void | Promise<void>;
}

export interface OutboxDispatcher {
  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>;
  start(): void;
  onModuleInit(): void;
  onShutdown(): Promise<void>;
}

interface ClaimedRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: string;
  readonly attempts: number;
}

function claimedRow(row: Readonly<Record<string, unknown>>): ClaimedRow {
  const { id, topic, payload, attempts } = row;
  if (
    typeof id !== 'string' ||
    typeof topic !== 'string' ||
    typeof payload !== 'string' ||
    typeof attempts !== 'number' ||
    !Number.isInteger(attempts) ||
    attempts < 0
  ) {
    throw new Error('@zmdb/repository: invalid outbox row returned by the driver');
  }
  return { id, topic, payload, attempts };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deadRowFromInvalid(
  raw: Readonly<Record<string, unknown>>,
  attempts: number,
  lastError: string,
): DeadOutboxRow {
  return {
    id: typeof raw['id'] === 'string' ? raw['id'] : String(raw['id']),
    topic: typeof raw['topic'] === 'string' ? raw['topic'] : String(raw['topic']),
    payload: typeof raw['payload'] === 'string' ? raw['payload'] : String(raw['payload']),
    attempts,
    lastError,
  };
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`@zmdb/repository: ${name} must be a positive safe integer`);
  }
  return value;
}

const MAX_TIMER_MS = 2_147_483_647;

function timerDelay(name: string, value: number): number {
  const delay = positiveInteger(name, value);
  if (delay > MAX_TIMER_MS) {
    throw new Error(`@zmdb/repository: ${name} must not exceed ${MAX_TIMER_MS}`);
  }
  return delay;
}

export function createOutboxDispatcher(options: OutboxDispatcherOptions): OutboxDispatcher {
  const dialect = options.driver.dialect ?? 'postgres';
  const batch = positiveInteger('batch', options.batch ?? 100);
  const leaseMs = positiveInteger('leaseMs', options.leaseMs ?? 30_000);
  const idleMs = timerDelay('idleMs', options.idleMs ?? 1_000);
  const maxIdleMs = timerDelay('maxIdleMs', options.maxIdleMs ?? 30_000);
  const maxAttempts = positiveInteger('maxAttempts', options.maxAttempts ?? 10);
  if (maxIdleMs < idleMs) {
    throw new Error('@zmdb/repository: maxIdleMs must be greater than or equal to idleMs');
  }
  const backoffMs = options.backoffMs ?? (attempts => Math.min(2 ** attempts * 1_000, 300_000));

  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activePasses = new Set<
    Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>
  >();
  let nextIdleMs = idleMs;

  const runPass = async () => {
    const now = new Date();
    const candidates = await options.driver.execute(outboxCandidatesQuery(dialect, { now, batch }));
    const ids = candidates.flatMap(row => (typeof row['id'] === 'string' ? [row['id']] : []));
    if (ids.length === 0) return { claimed: 0, delivered: 0, failed: 0 } as const;

    const token = globalThis.crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    await options.driver.execute(outboxClaimQuery(dialect, { now, token, leaseUntil, ids }));
    const candidateOrder = new Map(ids.map((id, index) => [id, index]));
    const rows = (await options.driver.execute(outboxReadBackQuery(dialect, { token }))).toSorted((left, right) => {
      const leftIndex = typeof left['id'] === 'string' ? candidateOrder.get(left['id']) : undefined;
      const rightIndex = typeof right['id'] === 'string' ? candidateOrder.get(right['id']) : undefined;
      return (leftIndex ?? ids.length) - (rightIndex ?? ids.length);
    });

    let delivered = 0;
    let failed = 0;
    for (const raw of rows) {
      let row: ClaimedRow;
      try {
        row = claimedRow(raw);
      } catch (error) {
        failed += 1;
        const id = raw['id'];
        const previousAttempts = raw['attempts'];
        if (typeof id !== 'string' || typeof previousAttempts !== 'number' || !Number.isInteger(previousAttempts)) {
          throw error;
        }
        const attempts = previousAttempts + 1;
        const lastError = errorMessage(error);
        await options.driver.execute(outboxMarkDeadQuery(dialect, { id, token, attempts, lastError }));
        await options.onDead?.(deadRowFromInvalid(raw, attempts, lastError));
        continue;
      }
      const attempts = row.attempts + 1;
      let publishError: unknown;
      try {
        await options.publish(row.topic, row.payload);
      } catch (error) {
        publishError = error;
      }
      if (publishError === undefined) {
        await options.driver.execute(
          outboxMarkDeliveredQuery(dialect, {
            id: row.id,
            token,
            deliveredAt: new Date(),
            attempts,
          }),
        );
        delivered += 1;
      } else {
        failed += 1;
        const lastError = errorMessage(publishError);
        if (attempts >= maxAttempts) {
          await options.driver.execute(outboxMarkDeadQuery(dialect, { id: row.id, token, attempts, lastError }));
          await options.onDead?.({ ...row, attempts, lastError });
        } else {
          const delay = backoffMs(attempts);
          if (!Number.isFinite(delay) || delay < 0) {
            throw new Error('@zmdb/repository: backoffMs must return a finite non-negative number');
          }
          await options.driver.execute(
            outboxMarkRetryQuery(dialect, {
              id: row.id,
              token,
              attempts,
              lastError,
              leaseUntil: new Date(Date.now() + delay),
            }),
          );
        }
      }
    }
    return { claimed: rows.length, delivered, failed };
  };

  const runOnce = (): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }> => {
    if (stopped) return Promise.resolve({ claimed: 0, delivered: 0, failed: 0 });
    const pass = runPass();
    activePasses.add(pass);
    void pass.then(
      () => activePasses.delete(pass),
      () => activePasses.delete(pass),
    );
    return pass;
  };

  const schedule = (delay: number): void => {
    timer = setTimeout(() => {
      if (stopped) return;
      const pass = runOnce();
      void pass.then(
        report => {
          if (stopped) return;
          if (report.claimed > 0) {
            nextIdleMs = idleMs;
            schedule(report.claimed >= batch ? 0 : nextIdleMs);
          } else {
            nextIdleMs = Math.min(nextIdleMs * 2, maxIdleMs);
            schedule(nextIdleMs);
          }
        },
        () => {
          if (!stopped) schedule(nextIdleMs);
        },
      );
    }, delay);
  };

  const start = (): void => {
    if (started || stopped) return;
    started = true;
    schedule(idleMs);
  };

  return {
    runOnce,
    start,
    onModuleInit: start,
    async onShutdown() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      while (activePasses.size > 0) {
        await Promise.allSettled(activePasses);
      }
    },
  };
}
