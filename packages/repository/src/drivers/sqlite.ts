// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

export type SQLInputValue = null | number | bigint | string | Uint8Array;

export interface DatabaseStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface DatabaseSync {
  prepare(sql: string): DatabaseStatement;
}

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as SQLInputValue[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}
