// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { DatabaseSync } from 'node:sqlite';

import type { QueryEffects } from '@zmdb/sql';
import { describe, expect, it, vi } from 'vitest';

import { sqlite } from './dialect.js';
import { sqliteDriver, type SqliteDatabase, type SqliteStatement } from './driver.js';

const read: QueryEffects = { operation: 'SELECT', requiresPrimary: false, returnsRows: true };
const write: QueryEffects = { operation: 'INSERT', requiresPrimary: true, returnsRows: false };

describe('sqliteDriver', () => {
  it('uses declared row effects when an adapter has no native column metadata', async () => {
    const all = vi.fn(() => [{ id: 1 }]);
    const run = vi.fn();
    const driver = sqliteDriver({
      exec: vi.fn(),
      prepare: () => ({
        all,
        run,
        *iterate() {
          yield { id: 1 };
        },
      }),
    });
    await driver.execute({
      text: 'INSERT INTO notes (body) VALUES (?) /* RETURNING is only a comment */',
      parameters: ['RETURNING'],
      effects: { operation: 'INSERT', requiresPrimary: true, returnsRows: false },
    });
    expect(run).toHaveBeenCalledWith('RETURNING');
    expect(all).not.toHaveBeenCalled();
    expect(
      await driver.execute({
        text: 'WITH items AS (SELECT 1 AS id) SELECT id FROM items',
        parameters: [],
        effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true },
      }),
    ).toEqual([{ id: 1 }]);
  });

  it('binds Date as sortable ISO UTC text', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE events (at TEXT NOT NULL)');
      const driver = sqliteDriver(database);

      await driver.execute({
        text: 'INSERT INTO events (at) VALUES (?)',
        effects: write,
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
        effects: write,
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
      expect(
        await driver.execute({ text: 'SELECT ? AS yes, ? AS no', effects: read, parameters: [true, false] }),
      ).toEqual([{ yes: 1, no: 0 }]);
    } finally {
      database.close();
    }
  });

  it('returns rows from read-only PRAGMA statements', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const rows = await sqliteDriver(database).execute({ text: 'PRAGMA foreign_keys', effects: read, parameters: [] });
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
          effects: read,
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
      await driver.execute({ text: 'SELECT 1', effects: read, parameters: [] });
      await driver.execute({ text: 'SELECT 2', effects: read, parameters: [] });
      await driver.execute({ text: 'SELECT 1', effects: read, parameters: [] });
      await driver.execute({ text: 'SELECT 3', effects: read, parameters: [] });
      await driver.execute({ text: 'SELECT 1', effects: read, parameters: [] });
      await driver.execute({ text: 'SELECT 2', effects: read, parameters: [] });
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
    for await (const row of stream({ text: 'SELECT id FROM events', effects: read, parameters: [] })) rows.push(row);

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

      const iterator = stream({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', effects: read, parameters: [] })[
        Symbol.asyncIterator
      ]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } });
      await expect(
        driver.execute({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', effects: read, parameters: [] }),
      ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 2 } });
      await driver.execute({ text: 'SELECT 3 AS id', effects: read, parameters: [] });
      await iterator.return?.();
      await driver.execute({ text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id', effects: read, parameters: [] });

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
      await expect(
        driver.execute({ text: 'SELECT 1', effects: read, parameters: [] }, { signal: before.signal }),
      ).rejects.toBe(beforeReason);

      const stream = driver.stream;
      if (stream === undefined) throw new Error('sqliteDriver did not expose stream');
      const between = new AbortController();
      const betweenReason = new Error('between rows');
      const iterator = stream(
        { text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id ORDER BY id', effects: read, parameters: [] },
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
          await transaction.execute({ text: 'INSERT INTO events (id) VALUES (?)', effects: write, parameters: [1] });
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
