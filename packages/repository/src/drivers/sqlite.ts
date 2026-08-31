// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

/** Minimal structural type for node:sqlite Statement. */
export interface SqliteStatement {
  all(...params: readonly unknown[]): unknown[];
  run(...params: readonly unknown[]): unknown;
}

/** Minimal structural type for node:sqlite DatabaseSync. */
export interface SqliteDatabaseSync {
  prepare(sql: string): SqliteStatement;
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
