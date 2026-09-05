// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.js';
import type { TransactionalDriver } from './transactional.js';

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
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

export interface SqliteOptions {
  maxCacheSize?: number;
}

interface CachedStatement {
  stmt: SqliteStatement;
  isRead: boolean;
}

/**
 * The app→db crossing for SQLite (plan D3).
 *
 * `node:sqlite` binds `null`, a number, a bigint, a string and a `Uint8Array`, and throws
 * "Provided value cannot be bound to SQLite parameter N" for anything else. A `Date` is
 * exactly that anything else, and it is also the app type of every `timestamp` column — so
 * before this, a `timestamp` could not be written through this driver at all: passing a
 * `Date` threw here and passing a string was the wrong type one layer up.
 *
 * ISO-8601 is not an arbitrary choice of encoding. It is what the DDL emitter declares the
 * column as (`TEXT`), what the wire layer carries, and — being fixed-width and
 * zero-padded — the one text form whose lexicographic order is its chronological order, so
 * `WHERE at > ?` and `ORDER BY at` mean what they say. UTC for the same reason: an offset
 * would break that ordering.
 *
 * Applied to every parameter rather than per column, because the driver has no schema and
 * needs none: there is one right answer for a `Date` here regardless of which column it
 * was bound for.
 */
function bindable(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: SqliteDatabase, opts?: SqliteOptions): TransactionalDriver {
  db.exec('PRAGMA foreign_keys = ON');
  const maxCacheSize = opts?.maxCacheSize ?? 1000;
  const cache = new Map<string, CachedStatement>();

  const driver: TransactionalDriver = {
    dialect: 'sqlite',
    async execute(q) {
      let entry = maxCacheSize > 0 ? cache.get(q.text) : undefined;
      if (!entry) {
        const isRead = /^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text);
        const stmt = db.prepare(q.text);
        entry = { stmt, isRead };
        if (maxCacheSize > 0) {
          if (cache.size >= maxCacheSize) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey !== undefined) {
              cache.delete(oldestKey);
            }
          }
          cache.set(q.text, entry);
        }
      } else if (maxCacheSize > 0) {
        cache.delete(q.text);
        cache.set(q.text, entry);
      }

      const parameters = q.parameters.map(bindable);
      if (entry.isRead) {
        // boundary: rows leave the database untyped. `all()` is declared
        // `unknown[]` (the widest shape every @types/node version agrees on);
        // node:sqlite always yields plain row objects for a row-returning
        // statement, and callers re-type them at the repository's row boundary.
        return entry.stmt.all(...parameters) as Record<string, unknown>[];
      }
      entry.stmt.run(...parameters);
      return [];
    },
    async transaction<Result>(run: (driver: Driver) => Promise<Result>): Promise<Result> {
      db.exec('BEGIN');
      try {
        const result = await run(driver);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return driver;
}
