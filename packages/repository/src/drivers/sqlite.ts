// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: SqliteDatabase): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}
