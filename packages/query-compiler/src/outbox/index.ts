import {
  createQueryCompiler,
  dialectTraits,
  type CompiledQuery,
  type DialectOutbox,
  type DialectTarget,
} from '../index.js';
import { quoteIdentifier } from '../quoting.js';

export const OUTBOX_TABLE = 'zmdb_outbox';
export type OutboxStatus = 'pending' | 'delivered' | 'dead';

const PENDING: OutboxStatus = 'pending';

export interface OutboxMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

/**
 * Most dialects index only pending rows. Dialects that cannot represent the
 * predicate use the full composite index with `status` first to preserve a
 * useful pending-row prefix instead of degrading to an unindexed scan.
 */
export function outboxPendingIndexDdl(dialect: DialectTarget): string {
  const definition = {
    name: 'zmdb_outbox_pending',
    table: OUTBOX_TABLE,
    columns: ['status', 'lease_until', 'created_at'],
    ...(outboxDialect(dialect).pendingIndex === 'full' ? {} : { where: "status = 'pending'" }),
  };
  const statements = dialect.migrations.emitSchemaObject({
    kind: 'create_index',
    definition,
  });
  if (statements.length !== 1 || statements[0] === undefined) {
    throw new TypeError(`${dialect.name} outbox index emission must return exactly one statement`);
  }
  return statements[0];
}

function outboxDialect(dialect: DialectTarget): DialectOutbox {
  if (dialect.outbox === undefined) {
    throw new TypeError(`${dialect.name} does not provide an outbox DDL strategy`);
  }
  return dialect.outbox;
}

/** The declared outbox table's migration DDL, including the defaults its type tags cannot carry. */
export function outboxTableDdl(dialect: DialectTarget): string {
  const q = (name: string) => quoteIdentifier(dialect, name);
  const traits = dialectTraits(dialect);
  const outbox = outboxDialect(dialect);
  const timestamp = traits.types.timestamp;
  // MySQL refuses TEXT primary keys and TEXT columns in an index without a prefix
  // length. These three values are bounded by construction, so the migration uses
  // bounded storage there while the application type remains string.
  const text = traits.types.text;
  const idType = outbox.boundedTextType(36);
  const statusType = outbox.boundedTextType(16);
  const leaseOwnerType = outbox.boundedTextType(36);
  return (
    `${outbox.createTable} ${q(OUTBOX_TABLE)} (` +
    `${q('id')} ${idType} PRIMARY KEY, ` +
    `${q('topic')} ${text} NOT NULL, ` +
    `${q('payload')} ${text} NOT NULL, ` +
    `${q('status')} ${statusType} NOT NULL DEFAULT 'pending', ` +
    `${q('attempts')} ${traits.types.integer} NOT NULL DEFAULT 0, ` +
    `${q('created_at')} ${timestamp} NOT NULL DEFAULT ${outbox.createdAtDefault}, ` +
    `${q('lease_owner')} ${leaseOwnerType} NOT NULL DEFAULT '', ` +
    `${q('lease_until')} ${timestamp} NOT NULL DEFAULT ${outbox.epochLiteral}, ` +
    `${q('delivered_at')} ${timestamp}, ` +
    `${q('last_error')} ${text})`
  );
}

/** A normal migration value applications can place in their ordered migration list. */
export function outboxMigration(version: number, dialect: DialectTarget): OutboxMigration {
  return {
    version,
    name: 'create_zmdb_outbox',
    up: `${outboxTableDdl(dialect)}; ${outboxPendingIndexDdl(dialect)}`,
    down: `DROP TABLE ${quoteIdentifier(dialect, OUTBOX_TABLE)}`,
  };
}

export function outboxCandidatesQuery(
  dialect: DialectTarget,
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
  dialect: DialectTarget,
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

export function outboxReadBackQuery(dialect: DialectTarget, args: { readonly token: string }): CompiledQuery {
  return createQueryCompiler(dialect)
    .selectFrom(OUTBOX_TABLE)
    .select(['id', 'topic', 'payload', 'attempts'])
    .where('lease_owner', '=', args.token)
    .compile();
}

export function outboxMarkDeliveredQuery(
  dialect: DialectTarget,
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
  dialect: DialectTarget,
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
  dialect: DialectTarget,
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
