// node:sqlite driver adapter — see ../drivers/SPEC.md.
export type DatabaseSync = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): void;
  };
};

import type { Driver } from '../index.ts';

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params);
      }
      stmt.run(...params);
      return [];
    },
  };
}
