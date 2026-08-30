// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { DatabaseSync } from 'node:sqlite';
import type { Driver } from '../index.ts';

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = (q.parameters ?? []) as (string | number | bigint | Uint8Array | null)[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}
