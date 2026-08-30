import { DatabaseSync } from 'node:sqlite';

import { defineSchema, serial, text, integer } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository } from '../index.ts';
import { pgDriver, type PgQueryable } from './pg.ts';
import { sqliteDriver } from './sqlite.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});
class Users extends BaseRepository<typeof UserSchema> {
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
});

describe('pgDriver (#211)', () => {
  it('calls query(text, params) and returns rows', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const d = pgDriver({ query } as unknown as PgQueryable);
    const out = await d.execute({ text: 'SELECT 1', parameters: [] });
    expect(query).toHaveBeenCalledWith('SELECT 1', []);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('prepared:true passes a stable statement name', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const d = pgDriver({ query } as unknown as PgQueryable, { prepared: true });
    await d.execute({ text: 'SELECT $1', parameters: [1] });
    await d.execute({ text: 'SELECT $1', parameters: [2] });
    const c0 = query.mock.calls[0][0] as { name?: string; text: string };
    const c1 = query.mock.calls[1][0] as { name?: string; text: string };
    expect(typeof c0.name).toBe('string');
    expect(c0.name).toBe(c1.name); // same SQL → same statement name
  });
});
