// Durable row declarations for @zmdb/web/queues.
//
// The worker owns the state machine; repository owns the schema vocabulary
// because table declarations and their generated migrations belong here.
import type { Dialect } from '@zmdb/query-compiler';
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';
import type { HasDefault, PrimaryKey, Sql, Table, Unique } from '@zmdb/schema-core/tags';

export type JobStatus = 'pending' | 'done' | 'dead';
export type JobDeadReason = 'invalid-payload' | 'unknown-name' | 'attempts-exhausted';

export interface JobRow extends Table<'zmdb_job'> {
  id: string & Sql<'text'> & PrimaryKey;
  name: string & Sql<'text'>;
  payload: string & Sql<'text'>;
  status: JobStatus & Sql<'jsonEnum'> & HasDefault;
  attempts: number & Sql<'integer'> & HasDefault;
  enqueuedAt: Date & Sql<'timestamp'>;
  dedupeKey: (string & Sql<'text'> & Unique) | null;
  leaseOwner: string & Sql<'text'> & HasDefault;
  leaseUntil: Date & Sql<'timestamp'> & HasDefault;
  lastError: (string & Sql<'text'>) | null;
  deadReason: (JobDeadReason & Sql<'jsonEnum'>) | null;
  deadDetail: (string & Sql<'text'>) | null;
  deadAt: (Date & Sql<'timestamp'>) | null;
}

export interface JobDoneRow extends Table<'zmdb_job_done'> {
  key: string & Sql<'text'> & PrimaryKey;
  completedAt: Date & Sql<'timestamp'>;
}

/** The claim index: partial where supported, status-leading on MySQL. */
export function jobPendingIndexDdl(dialect: Dialect): string {
  return createIndexDdl(
    {
      name: 'zmdb_job_pending',
      table: 'zmdb_job',
      columns: ['status', 'lease_until', 'enqueued_at'],
      ...(dialect === 'mysql' ? {} : { where: "status = 'pending'" }),
    },
    dialect,
  );
}
