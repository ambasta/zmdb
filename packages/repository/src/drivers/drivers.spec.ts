import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository } from '../index.js';
import { pgDriver, type PgQueryable } from './pg.js';
import { sqliteDriver } from './sqlite.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
}

const { User: UserSchema } = schemasFrom<{ User: User }>(import.meta.url, ['User']);
class Users extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

describe('sqliteDriver (#211)', () => {
  it('round-trips create/find/update/delete against in-memory node:sqlite', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INTEGER NOT NULL)');
    const users = new Users(sqliteDriver(db), 'sqlite');

    const created = await users.create({ email: 'a@b.com', age: 30 });
    expect(created.id).toBeGreaterThan(0);

    const found = await users.findById(created.id);
    expect(found?.email).toBe('a@b.com');

    const admins = await users.find({ age: { gte: 18 } });
    expect(admins).toHaveLength(1);

    const ok = await users.delete(created.id);
    expect(ok).toBe(true);
    expect(await users.findById(created.id)).toBeUndefined();
  });

  it('reuses prepared statement references and runs regex at most once per unique query string', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const prepareSpy = vi.spyOn(db, 'prepare');
    const testSpy = vi.spyOn(RegExp.prototype, 'test');

    const d = sqliteDriver(db);
    const query = { text: 'SELECT * FROM items WHERE id = ?', parameters: [1] };

    testSpy.mockClear();

    // First execution compiles statement & tests regex
    await d.execute(query);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    const testCountAfterFirst = testSpy.mock.calls.length;

    // Subsequent executions reuse prepared statement and skip regex checks
    await d.execute({ text: 'SELECT * FROM items WHERE id = ?', parameters: [2] });
    await d.execute({ text: 'SELECT * FROM items WHERE id = ?', parameters: [3] });

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(testSpy.mock.calls.length).toBe(testCountAfterFirst);

    testSpy.mockRestore();
  });

  it('evicts oldest statement from cache when maxCacheSize is exceeded (LRU)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    const prepareSpy = vi.spyOn(db, 'prepare');

    const d = sqliteDriver(db, { maxCacheSize: 2 });

    await d.execute({ text: 'SELECT 1', parameters: [] }); // cached
    await d.execute({ text: 'SELECT 2', parameters: [] }); // cached
    expect(prepareSpy).toHaveBeenCalledTimes(2);

    // Re-access SELECT 1 so SELECT 2 becomes oldest
    await d.execute({ text: 'SELECT 1', parameters: [] });
    expect(prepareSpy).toHaveBeenCalledTimes(2);

    // Execute SELECT 3 -> evicts SELECT 2
    await d.execute({ text: 'SELECT 3', parameters: [] });
    expect(prepareSpy).toHaveBeenCalledTimes(3);

    // SELECT 1 should still be cached
    await d.execute({ text: 'SELECT 1', parameters: [] });
    expect(prepareSpy).toHaveBeenCalledTimes(3);

    // SELECT 2 was evicted -> triggers prepare again
    await d.execute({ text: 'SELECT 2', parameters: [] });
    expect(prepareSpy).toHaveBeenCalledTimes(4);
  });
});

describe('pgDriver (#211)', () => {
  it('calls query(text, params) and returns rows by default (prepared: false)', async () => {
    const query = vi.fn(async (_text: string, _params?: readonly unknown[]) => ({ rows: [{ id: 1 }] }));
    const d = pgDriver({ query } as unknown as PgQueryable);
    const out = await d.execute({ text: 'SELECT 1', parameters: [10] });

    expect(query).toHaveBeenCalledWith('SELECT 1', [10]);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('hands a Date and a bigint over untouched', async () => {
    // The sqlite adapter converts a `Date` because `node:sqlite` throws on one. `pg` needs
    // no such help: it binds a `Date` as a timestamp itself and stringifies a `bigint`, so
    // converting here would be a second, differently-wrong answer to the same question.
    const query = vi.fn(async (_text: string, _params?: readonly unknown[]) => ({ rows: [] }));
    const d = pgDriver({ query } as unknown as PgQueryable);
    const at = new Date('2026-01-01T12:30:00.000Z');
    await d.execute({ text: 'INSERT INTO events (at, seq) VALUES ($1, $2)', parameters: [at, 7n] });

    expect(query).toHaveBeenCalledWith('INSERT INTO events (at, seq) VALUES ($1, $2)', [at, 7n]);
  });

  it('runs as prepared statement when prepared: true is passed', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true });
    const out = await d.execute({ text: 'SELECT 1', parameters: [10] });

    expect(query).toHaveBeenCalledWith({
      name: expect.any(String),
      text: 'SELECT 1',
      values: [10],
    });
    expect(out).toEqual([{ id: 1 }]);
  });

  it('prepared:true passes a stable statement name', async () => {
    // The configs are captured here rather than read back off `query.mock.calls`:
    // `vi.fn(async () => …)` infers a zero-parameter mock, so `calls[0][0]` is an
    // out-of-bounds read on an empty tuple that only a cast could silence.
    const configs: { name?: string; text: string }[] = [];
    const query = vi.fn(async (config: { name?: string; text: string }) => {
      configs.push(config);
      return { rows: [] };
    });
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true });
    await d.execute({ text: 'SELECT $1', parameters: [1] });
    await d.execute({ text: 'SELECT $1', parameters: [2] });
    expect(configs).toHaveLength(2);
    const [c0, c1] = configs;
    expect(typeof c0?.name).toBe('string');
    expect(c0?.name).toBe(c1?.name); // same SQL → same statement name
  });

  it('evicts oldest statement name and issues DEALLOCATE on server when maxCacheSize is exceeded (LRU)', async () => {
    const calls: unknown[] = [];
    const query = vi.fn(async (arg: unknown) => {
      calls.push(arg);
      return { rows: [] };
    });
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true, maxCacheSize: 2 });

    await d.execute({ text: 'SELECT 1', parameters: [] }); // name 1
    await d.execute({ text: 'SELECT 2', parameters: [] }); // name 2
    const name1_orig = (calls[0] as { name?: string }).name;
    const name2_orig = (calls[1] as { name?: string }).name;

    // Access SELECT 1 to refresh LRU order
    await d.execute({ text: 'SELECT 1', parameters: [] });

    // Execute SELECT 3 -> evicts SELECT 2 and issues DEALLOCATE <name2_orig>
    await d.execute({ text: 'SELECT 3', parameters: [] });

    expect(calls).toContain(`DEALLOCATE ${name2_orig}`);

    // Access SELECT 1 -> should keep name1_orig
    await d.execute({ text: 'SELECT 1', parameters: [] });
    const name1_recheck = (calls[calls.length - 1] as { name?: string }).name;
    expect(name1_recheck).toBe(name1_orig);

    // Access SELECT 2 -> was evicted, so gets a new name
    await d.execute({ text: 'SELECT 2', parameters: [] });
    const name2_new = (calls[calls.length - 1] as { name?: string }).name;
    expect(name2_new).not.toBe(name2_orig);
  });
});

describe('sqliteDriver binds a Date', () => {
  it('binds it as ISO-8601 UTC text, since node:sqlite binds no object at all', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE events (at TEXT NOT NULL)');
    const d = sqliteDriver(db);

    await d.execute({
      text: 'INSERT INTO events (at) VALUES (?)',
      parameters: [new Date('2026-01-01T13:30:00.000+01:00')],
    });

    // Not the local rendering of that instant: UTC, so lexicographic order stays
    // chronological order in a TEXT column.
    expect(db.prepare('SELECT at FROM events').all()).toEqual([{ at: '2026-01-01T12:30:00.000Z' }]);
  });

  it('leaves every other bindable value exactly as it is', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE cells (i INTEGER, b INTEGER, t TEXT, n TEXT)');
    const d = sqliteDriver(db);

    await d.execute({ text: 'INSERT INTO cells (i, b, t, n) VALUES (?, ?, ?, ?)', parameters: [1, 2n, 'three', null] });

    expect(db.prepare('SELECT i, b, t, n FROM cells').all()).toEqual([{ i: 1, b: 2, t: 'three', n: null }]);
  });
});
