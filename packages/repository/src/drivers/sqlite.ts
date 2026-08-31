/// <reference types="node" />
// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

// Minimal structural types, for the same reason as `PgQueryable` in ./pg.ts: the
// adapter must not hard-depend on `@types/node` at build time (a repo that only
// ships ESM sources shouldn't need ambient Node types to typecheck). Methods are
// bivariant, so a real `node:sqlite` `DatabaseSync` is assignable to
// `SqliteDatabase` — pass one straight in.
export interface SqliteStatement {
  /** Returns rows for a SELECT/RETURNING statement. */
  all(...params: unknown[]): unknown[];
  /** Executes a non-returning statement. */
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
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        // boundary: rows leave the database untyped. `all()` is declared
        // `unknown[]` (the widest shape every @types/node version agrees on);
        // node:sqlite always yields plain row objects for a row-returning
        // statement, and callers re-type them at the repository's row boundary.
        return stmt.all(...q.parameters) as Record<string, unknown>[];
      }
      stmt.run(...q.parameters);
      return [];
    },
  };
}
