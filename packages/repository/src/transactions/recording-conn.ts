// The recording connection the transaction specs share.
//
// What those specs assert is the statement stream — BEGIN, SAVEPOINT s1,
// ROLLBACK TO SAVEPOINT s1, COMMIT, in that order — so the connection they run
// against records instead of executing. Three of them had written the same
// recorder out longhand.
import type { CompiledQuery } from '@zmdb/query-compiler';

import type { TxConnection } from './index.ts';

export interface RecordingConn extends TxConnection {
  /** Every statement the transaction machinery issued, in order. */
  readonly log: string[];
}

export interface RecordingConnOptions {
  /** What an `execute` writes to the log. Defaults to a bare `EXEC`, for specs that only care about ordering. */
  label?: (query: CompiledQuery) => string;
  /** What an `execute` returns, for specs that go on to assert on the rows. */
  rows?: readonly Record<string, unknown>[];
}

export function recordingConn(options: RecordingConnOptions = {}): RecordingConn {
  const { label = () => 'EXEC', rows = [] } = options;
  const log: string[] = [];
  return {
    log,
    async raw(sql: string) {
      log.push(sql);
    },
    async execute(query: CompiledQuery) {
      log.push(label(query));
      return rows;
    },
  };
}
