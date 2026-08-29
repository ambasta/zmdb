import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { BaseRepository, ValidationError, type Driver } from './index.ts';
import { defineSchema, serial, text, jsonEnum, primaryKey, notNull } from '@zmdb/schema-core';

// #29: end-to-end integration — a <10-line repository performing real CRUD
// against an in-process SQLite database (Node 26 built-in `node:sqlite`).

// A real SQLite driver: executes CompiledQuery (text + positional `?` params).
function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}

// The single source of truth.
const UserSchema = defineSchema('users', {
  id: primaryKey(serial()),
  email: notNull(text()),
  role: jsonEnum(['admin', 'user']),
});

// The ENTIRE repository — well under 10 lines.
class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}

let db: DatabaseSync;
let users: UserRepository;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, role TEXT)');
  users = new UserRepository(sqliteDriver(db), 'sqlite');
});

describe('repository E2E (real SQLite)', () => {
  it('create → findById → update → delete round-trip', async () => {
    const created = await users.create({ email: 'a@b.com', role: 'user' });
    expect(created).toMatchObject({ email: 'a@b.com', role: 'user' });
    const id = created.id;

    const found = await users.findById(id);
    expect(found).toMatchObject({ id, email: 'a@b.com', role: 'user' });

    const updated = await users.update(id, { role: 'admin' });
    expect(updated).toMatchObject({ id, role: 'admin' });

    expect(await users.delete(id)).toBe(true);
    expect(await users.findById(id)).toBeUndefined();
  });

  it('rejects an invalid create with ValidationError and writes nothing', async () => {
    await expect(users.create({ role: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    expect(await users.findAll()).toEqual([]);
  });

  it('findAll returns plain data objects (no proxy / no class instance)', async () => {
    await users.create({ email: 'x@y.com', role: 'user' });
    const all = await users.findAll();
    expect(all).toHaveLength(1);
    // node:sqlite returns null-prototype records — inert plain data, not a
    // proxy or ORM entity. Either null or Object.prototype is acceptable.
    const proto = Object.getPrototypeOf(all[0]);
    expect(proto === null || proto === Object.prototype).toBe(true);
    expect(all[0]).toMatchObject({ email: 'x@y.com', role: 'user' });
  });
});
