import type { Driver, TransactionalDriver } from '@zmdb/repository';

import { sqlite } from './dialect.js';

// Minimal structural types keep the adapter independent of `@types/node` at
// build time. Methods are bivariant, so a real `node:sqlite` `DatabaseSync` is
// assignable to `SqliteDatabase` — pass one straight in.
export interface SqliteStatement {
  /** Returns rows for a row-returning statement such as SELECT, PRAGMA or RETURNING. */
  all(...params: unknown[]): unknown[];
  /** Describes result columns without executing the statement (`node:sqlite` provides this). */
  columns?(): readonly unknown[];
  /** Executes a non-returning statement. */
  run(...params: unknown[]): unknown;
  /** Steps a row-returning statement without materialising the result. */
  iterate(...params: unknown[]): Iterable<Record<string, unknown>>;
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
  activeIterators: number;
}

/**
 * The app→db crossing for SQLite (plan D3).
 *
 * `node:sqlite` binds `null`, a boolean, a number, a bigint, a string and a `Uint8Array`, and
 * throws "Provided value cannot be bound to SQLite parameter N" for anything else. A `Date`
 * is exactly that anything else, and it is also the app type of every `timestamp` column —
 * so before this, a `timestamp` could not be written through this driver at all: passing a
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
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(db: SqliteDatabase, opts?: SqliteOptions): TransactionalDriver<'sqlite'> {
  db.exec('PRAGMA foreign_keys = ON');
  const maxCacheSize = opts?.maxCacheSize ?? 1000;
  const cache = new Map<string, CachedStatement>();

  const statementFor = (text: string): CachedStatement => {
    let entry = maxCacheSize > 0 ? cache.get(text) : undefined;
    if (entry !== undefined && entry.activeIterators === 0) {
      cache.delete(text);
      cache.set(text, entry);
      return entry;
    }

    const stmt = db.prepare(text);
    const columns = stmt.columns?.();
    entry = {
      stmt,
      isRead:
        columns === undefined ? /^\s*(?:SELECT|PRAGMA)\b/i.test(text) || /RETURNING/i.test(text) : columns.length > 0,
      activeIterators: 0,
    };
    if (maxCacheSize <= 0) return entry;

    if (cache.size >= maxCacheSize) {
      const evictable = [...cache].find(([, candidate]) => candidate.activeIterators === 0);
      if (evictable !== undefined) cache.delete(evictable[0]);
    }
    if (cache.size < maxCacheSize) cache.set(text, entry);
    return entry;
  };

  const driver: TransactionalDriver<'sqlite'> = {
    dialect: sqlite,
    async execute(q, executeOpts) {
      const signal = executeOpts?.signal;
      signal?.throwIfAborted();
      const entry = statementFor(q.text);
      const parameters = q.parameters.map(bindable);
      if (entry.isRead) {
        // boundary: rows leave the database untyped. `all()` is declared
        // `unknown[]` (the widest shape every @types/node version agrees on);
        // node:sqlite always yields plain row objects for a row-returning
        // statement, and callers re-type them at the repository's row boundary.
        const rows = entry.stmt.all(...parameters) as Record<string, unknown>[];
        signal?.throwIfAborted();
        return rows;
      }
      entry.stmt.run(...parameters);
      signal?.throwIfAborted();
      return [];
    },
    stream(q, executeOpts) {
      const signal = executeOpts?.signal;
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>, void, unknown> {
          signal?.throwIfAborted();
          const entry = statementFor(q.text);
          if (!entry.isRead) throw new Error('sqliteDriver.stream requires a row-returning statement');
          const parameters = q.parameters.map(bindable);
          entry.activeIterators++;
          let completed = false;
          let iterator: Iterator<Record<string, unknown>> | undefined;
          try {
            iterator = entry.stmt.iterate(...parameters)[Symbol.iterator]();
            for (;;) {
              // node:sqlite has no sqlite3_interrupt binding. JavaScript regains
              // control only between native steps, so abort can stop further
              // rows but cannot interrupt one slow step already in SQLite.
              signal?.throwIfAborted();
              const next = iterator.next();
              signal?.throwIfAborted();
              if (next.done) {
                completed = true;
                return;
              }
              yield next.value;
            }
          } finally {
            try {
              if (!completed && iterator?.return !== undefined) iterator.return();
            } finally {
              entry.activeIterators--;
            }
          }
        },
      };
    },
    async transaction<Result>(run: (driver: Driver<'sqlite'>) => Promise<Result>): Promise<Result> {
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
