import { createQueryCompiler, type CompiledQuery, type Dialect } from '../index.js';
import type { Migration } from '../migrations/runner.js';
import { quoteIdentifier } from '../quoting.js';
import { createIndexDdl } from '../schema-objects/index.js';

export const OUTBOX_TABLE = 'zmdb_outbox';
export type OutboxStatus = 'pending' | 'delivered' | 'dead';

const PENDING: OutboxStatus = 'pending';

/**
 * Postgres and SQLite index only pending rows. MySQL has no partial index, so
 * it gets the full composite index with `status` first to preserve a useful
 * pending-row prefix instead of degrading to an unindexed scan.
 */
export function outboxPendingIndexDdl(dialect: Dialect): string {
  return createIndexDdl(
    {
      name: 'zmdb_outbox_pending',
      table: OUTBOX_TABLE,
      columns: ['status', 'lease_until', 'created_at'],
      ...(dialect === 'mysql' ? {} : { where: "status = 'pending'" }),
    },
    dialect,
  );
}

function timestampType(dialect: Dialect): string {
  if (dialect === 'postgres') return 'TIMESTAMPTZ';
  if (dialect === 'mysql') return 'DATETIME(3)';
  return 'TEXT';
}

function epochLiteral(dialect: Dialect): string {
  return dialect === 'mysql' ? "'1970-01-01 00:00:00.000'" : "'1970-01-01T00:00:00.000Z'";
}

function createdAtDefault(dialect: Dialect): string {
  if (dialect === 'mysql') return 'CURRENT_TIMESTAMP(3)';
  if (dialect === 'sqlite') return "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
  return 'CURRENT_TIMESTAMP';
}

/** The declared outbox table's migration DDL, including the defaults its type tags cannot carry. */
export function outboxTableDdl(dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(dialect, name);
  const timestamp = timestampType(dialect);
  const createdDefault = createdAtDefault(dialect);
  // MySQL refuses TEXT primary keys and TEXT columns in an index without a prefix
  // length. These three values are bounded by construction, so the migration uses
  // bounded storage there while the application type remains string.
  const idType = dialect === 'mysql' ? 'VARCHAR(36)' : 'TEXT';
  const statusType = dialect === 'mysql' ? 'VARCHAR(16)' : 'TEXT';
  const leaseOwnerType = dialect === 'mysql' ? 'VARCHAR(36)' : 'TEXT';
  return (
    `CREATE TABLE ${q(OUTBOX_TABLE)} (` +
    `${q('id')} ${idType} PRIMARY KEY, ` +
    `${q('topic')} TEXT NOT NULL, ` +
    `${q('payload')} TEXT NOT NULL, ` +
    `${q('status')} ${statusType} NOT NULL DEFAULT 'pending', ` +
    `${q('attempts')} ${dialect === 'mysql' ? 'INT' : 'INTEGER'} NOT NULL DEFAULT 0, ` +
    `${q('created_at')} ${timestamp} NOT NULL DEFAULT ${createdDefault}, ` +
    `${q('lease_owner')} ${leaseOwnerType} NOT NULL DEFAULT '', ` +
    `${q('lease_until')} ${timestamp} NOT NULL DEFAULT ${epochLiteral(dialect)}, ` +
    `${q('delivered_at')} ${timestamp}, ` +
    `${q('last_error')} TEXT)`
  );
}

/** A normal migration value applications can place in their ordered migration list. */
export function outboxMigration(version: number, dialect: Dialect): Migration {
  return {
    version,
    name: 'create_zmdb_outbox',
    up: `${outboxTableDdl(dialect)}; ${outboxPendingIndexDdl(dialect)}`,
    down: `DROP TABLE ${quoteIdentifier(dialect, OUTBOX_TABLE)}`,
  };
}

export function outboxCandidatesQuery(
  dialect: Dialect,
  args: { readonly now: Date; readonly batch: number },
): CompiledQuery {
  return createQueryCompiler(dialect)
    .selectFrom(OUTBOX_TABLE)
    .select(['id'])
    .where('status', '=', PENDING)
    .where('lease_until', '<', args.now)
    .orderBy('created_at', 'asc')
    .limit(args.batch)
    .compile();
}

export function outboxClaimQuery(
  dialect: Dialect,
  args: {
    readonly now: Date;
    readonly token: string;
    readonly leaseUntil: Date;
    readonly ids: readonly string[];
  },
): CompiledQuery {
  return createQueryCompiler(dialect)
    .updateTable(OUTBOX_TABLE)
    .set({ lease_owner: args.token, lease_until: args.leaseUntil })
    .where('status', '=', PENDING)
    .where('lease_until', '<', args.now)
    .whereIn('id', args.ids)
    .compile();
}

export function outboxReadBackQuery(dialect: Dialect, args: { readonly token: string }): CompiledQuery {
  return createQueryCompiler(dialect)
    .selectFrom(OUTBOX_TABLE)
    .select(['id', 'topic', 'payload', 'attempts'])
    .where('lease_owner', '=', args.token)
    .compile();
}

export function outboxMarkDeliveredQuery(
  dialect: Dialect,
  args: {
    readonly id: string;
    readonly token: string;
    readonly deliveredAt: Date;
    readonly attempts: number;
  },
): CompiledQuery {
  return createQueryCompiler(dialect)
    .updateTable(OUTBOX_TABLE)
    .set({ status: 'delivered', delivered_at: args.deliveredAt, attempts: args.attempts })
    .where('id', '=', args.id)
    .where('lease_owner', '=', args.token)
    .compile();
}

export function outboxMarkRetryQuery(
  dialect: Dialect,
  args: {
    readonly id: string;
    readonly token: string;
    readonly attempts: number;
    readonly lastError: string;
    readonly leaseUntil: Date;
  },
): CompiledQuery {
  return createQueryCompiler(dialect)
    .updateTable(OUTBOX_TABLE)
    .set({ attempts: args.attempts, last_error: args.lastError, lease_until: args.leaseUntil })
    .where('id', '=', args.id)
    .where('lease_owner', '=', args.token)
    .compile();
}

export function outboxMarkDeadQuery(
  dialect: Dialect,
  args: {
    readonly id: string;
    readonly token: string;
    readonly attempts: number;
    readonly lastError: string;
  },
): CompiledQuery {
  return createQueryCompiler(dialect)
    .updateTable(OUTBOX_TABLE)
    .set({ status: 'dead', attempts: args.attempts, last_error: args.lastError })
    .where('id', '=', args.id)
    .where('lease_owner', '=', args.token)
    .compile();
}
