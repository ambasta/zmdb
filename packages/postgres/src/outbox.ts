import type { Migration } from '@zmdb/query-compiler/migrations';

export const POSTGRES_OUTBOX_TABLE = 'zmdb_outbox';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function postgresOutboxTableDdl(): string {
  const table = quoteIdentifier(POSTGRES_OUTBOX_TABLE);
  const column = quoteIdentifier;
  return (
    `CREATE TABLE ${table} (` +
    `${column('id')} TEXT PRIMARY KEY, ` +
    `${column('topic')} TEXT NOT NULL, ` +
    `${column('payload')} TEXT NOT NULL, ` +
    `${column('status')} TEXT NOT NULL DEFAULT 'pending', ` +
    `${column('attempts')} INTEGER NOT NULL DEFAULT 0, ` +
    `${column('created_at')} TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
    `${column('lease_owner')} TEXT NOT NULL DEFAULT '', ` +
    `${column('lease_until')} TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00.000Z', ` +
    `${column('delivered_at')} TIMESTAMPTZ, ` +
    `${column('last_error')} TEXT)`
  );
}

export function postgresOutboxPendingIndexDdl(): string {
  return (
    `CREATE INDEX ${quoteIdentifier('zmdb_outbox_pending')} ON ${quoteIdentifier(POSTGRES_OUTBOX_TABLE)} ` +
    `(${quoteIdentifier('status')}, ${quoteIdentifier('lease_until')}, ${quoteIdentifier('created_at')}) ` +
    "WHERE status = 'pending'"
  );
}

export function postgresOutboxMigration(version: number): Migration {
  return {
    version,
    name: 'create_zmdb_outbox',
    up: `${postgresOutboxTableDdl()}; ${postgresOutboxPendingIndexDdl()}`,
    down: `DROP TABLE ${quoteIdentifier(POSTGRES_OUTBOX_TABLE)}`,
  };
}
