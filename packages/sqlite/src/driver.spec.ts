import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import { sqlite } from './dialect.js';
import { sqliteDriver, type SqliteDatabase, type SqliteStatement } from './driver.js';

describe('sqliteDriver', () => {
  it('binds Date as sortable ISO UTC text', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE events (at TEXT NOT NULL)');
      const driver = sqliteDriver(database);

      await driver.execute({
        text: 'INSERT INTO events (at) VALUES (?)',
        parameters: [new Date('2026-01-01T13:30:00.000+01:00')],
      });

      expect(database.prepare('SELECT at FROM events').all()).toEqual([{ at: '2026-01-01T12:30:00.000Z' }]);
    } finally {
      database.close();
    }
  });

  it('leaves every other node:sqlite bindable value unchanged', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE cells (i INTEGER, b INTEGER, t TEXT, n TEXT)');
      await sqliteDriver(database).execute({
        text: 'INSERT INTO cells (i, b, t, n) VALUES (?, ?, ?, ?)',
        parameters: [1, 2n, 'three', null],
      });
      expect(database.prepare('SELECT i, b, t, n FROM cells').all()).toEqual([{ i: 1, b: 2, t: 'three', n: null }]);
    } finally {
      database.close();
    }
  });

  it('accepts node:sqlite boolean bindings for INTEGER storage', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const driver = sqliteDriver(database);
      expect(await driver.execute({ text: 'SELECT ? AS yes, ? AS no', parameters: [true, false] })).toEqual([
        { yes: 1, no: 0 },
      ]);
    } finally {
      database.close();
    }
  });

  it('returns rows from read-only PRAGMA statements', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const rows = await sqliteDriver(database).execute({ text: 'PRAGMA foreign_keys', parameters: [] });
      expect(rows).toEqual([{ foreign_keys: 1 }]);
    } finally {
      database.close();
    }
  });

  it('uses node:sqlite result metadata for row-returning CTEs', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const driver = sqliteDriver(database);
      expect(
        await driver.execute({
          text: 'WITH values_(value) AS (VALUES (1), (2)) SELECT value FROM values_ ORDER BY value',
          parameters: [],
        }),
      ).toEqual([{ value: 1 }, { value: 2 }]);
    } finally {
      database.close();
    }
  });

  it('reuses prepared statements and evicts the least-recently-used idle statement', async () => {
    const database = new DatabaseSync(':memory:');
    const prepare = vi.spyOn(database, 'prepare');
    try {
      const driver = sqliteDriver(database, { maxCacheSize: 2 });
      await driver.execute({ text: 'SELECT 1', parameters: [] });
      await driver.execute({ text: 'SELECT 2', parameters: [] });
      await driver.execute({ text: 'SELECT 1', parameters: [] });
      await driver.execute({ text: 'SELECT 3', parameters: [] });
      await driver.execute({ text: 'SELECT 1', parameters: [] });
      await driver.execute({ text: 'SELECT 2', parameters: [] });
      expect(prepare).toHaveBeenCalledTimes(4);
    } finally {
      database.close();
    }
  });

  it('streams without materialising all rows', async () => {
    let allCalls = 0;
    let iterateCalls = 0;
    const statement: SqliteStatement = {
      all(): unknown[] {
        allCalls += 1;
        throw new Error('stream materialised rows');
      },
      run(): unknown {
        return undefined;
      },
      *iterate(): Iterable<Record<string, unknown>> {
        iterateCalls += 1;
        yield { id: 1 };
        yield { id: 2 };
      },
    };
    const database: SqliteDatabase = {
      exec(): unknown {
        return undefined;
      },
      prepare(): SqliteStatement {
        return statement;
      },
    };
    const stream = sqliteDriver(database).stream;
    if (stream === undefined) throw new Error('sqliteDriver did not expose stream');

    const rows: Record<string, unknown>[] = [];
    for await (const row of stream({ text: 'SELECT id FROM events', parameters: [] })) rows.push(row);

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(iterateCalls).toBe(1);
    expect(allCalls).toBe(0);
  });

  it('does not evict an active statement', async () => {
    const database = new DatabaseSync(':memory:');
    const prepare = vi.spyOn(database, 'prepare');
    try {
      const driver = sqliteDriver(database, { maxCacheSize: 1 });
      const stream = driver.stream;
      if (stream === undefined) throw new Error('sqliteDriver did not expose stream');

      const iterator = stream({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', parameters: [] })[
        Symbol.asyncIterator
      ]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } });
      await expect(
        driver.execute({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', parameters: [] }),
      ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 2 } });
      await driver.execute({ text: 'SELECT 3 AS id', parameters: [] });
      await iterator.return?.();
      await driver.execute({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', parameters: [] });

      expect(prepare).toHaveBeenCalledTimes(3);
    } finally {
      database.close();
    }
  });

  it('observes abort before dispatch and between native iterator steps', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const driver = sqliteDriver(database);
      const before = new AbortController();
      const beforeReason = new Error('before dispatch');
      before.abort(beforeReason);
      await expect(driver.execute({ text: 'SELECT 1', parameters: [] }, { signal: before.signal })).rejects.toBe(
        beforeReason,
      );

      const stream = driver.stream;
      if (stream === undefined) throw new Error('sqliteDriver did not expose stream');
      const between = new AbortController();
      const betweenReason = new Error('between rows');
      const iterator = stream(
        { text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id ORDER BY id', parameters: [] },
        { signal: between.signal },
      )[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } });
      between.abort(betweenReason);
      await expect(iterator.next()).rejects.toBe(betweenReason);
    } finally {
      database.close();
    }
  });

  it('keeps a transaction callback on one database and rolls its writes back together', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE events (id INTEGER PRIMARY KEY)');
      const driver = sqliteDriver(database);
      await expect(
        driver.transaction(async transaction => {
          await transaction.execute({ text: 'INSERT INTO events (id) VALUES (?)', parameters: [1] });
          throw new Error('stop');
        }),
      ).rejects.toThrow('stop');
      expect(database.prepare('SELECT id FROM events').all()).toEqual([]);
      expect(driver.dialect).toBe(sqlite);
    } finally {
      database.close();
    }
  });
});
