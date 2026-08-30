// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

// Minimal structural type so we don't hard-depend on node:sqlite types at compile time.
export interface SqliteDatabaseSync {
  prepare(sql: string): {
    all(...params: readonly unknown[]): unknown[];
    run(...params: readonly unknown[]): unknown;
  };
}

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: SqliteDatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as readonly unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}
