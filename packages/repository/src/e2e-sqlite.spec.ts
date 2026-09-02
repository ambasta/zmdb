import { DatabaseSync } from 'node:sqlite';

import {
  bigint,
  defineSchema,
  jsonEnum,
  notNull,
  primaryKey,
  sensitive,
  serial,
  text,
  timestamp,
} from '@zmdb/schema-core';
import { describe, it, expect, beforeEach } from 'vitest';

import { sqliteDriver } from './drivers/sqlite.ts';
import { BaseRepository, ValidationError } from './index.ts';

// #29: end-to-end integration — a <10-line repository performing real CRUD
// against an in-process SQLite database (Node 26 built-in `node:sqlite`).

// The single source of truth.
const UserSchema = defineSchema('users', {
  id: primaryKey(serial()),
  email: notNull(text()),
  role: jsonEnum(['admin', 'user']).nullable(),
});

// The ENTIRE repository — well under 10 lines.
class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}

let db: DatabaseSync;
let users: UserRepository;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, role TEXT)');
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

  it('update payload with explicit undefined strips undefined, preserves nulls and leaves omitted fields unchanged', async () => {
    const created = await users.create({ email: 'a@b.com', role: 'admin' });
    const id = created.id;

    // Passing explicit undefined for email and explicit null for role (role is nullable in UserSchema)
    const updated = await users.update(id, { email: undefined, role: null });
    expect(updated).toMatchObject({ id, email: 'a@b.com', role: null });

    // Verify in database that email was unchanged and role was set to SQL NULL
    const reloaded = await users.findById(id);
    expect(reloaded?.email).toBe('a@b.com');
    expect(reloaded?.role).toBeNull();
  });

  it('rejects an invalid create with ValidationError and writes nothing', async () => {
    // @ts-expect-error — deliberately invalid input: `email` is missing and `role`
    // is not a member of the enum. Now that specs are inside the typecheck program
    // this directive is itself an assertion: the derived `CreateDTO` must reject
    // this literal, and the runtime validator must reject it too.
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

  it('preserves sensitive column unmasked data on reads and enforces payload validation', async () => {
    const SensitiveSchema = defineSchema('sensitive_users', {
      id: primaryKey(serial()),
      email: notNull(text()),
      passwordHash: sensitive(notNull(text())),
    });

    class SensitiveRepo extends BaseRepository<typeof SensitiveSchema> {
      static override readonly schema = SensitiveSchema;
    }

    db.exec(
      'CREATE TABLE sensitive_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, passwordHash TEXT NOT NULL)',
    );
    const sRepo = new SensitiveRepo(sqliteDriver(db), 'sqlite');

    // Validation failure if required sensitive field is missing
    await expect(sRepo.create({ email: 'user@test.com' } as never)).rejects.toBeInstanceOf(ValidationError);

    // Creates and returns unmasked sensitive field value
    const user = await sRepo.create({ email: 'user@test.com', passwordHash: 'hashed_secret_123' });
    expect(user.passwordHash).toBe('hashed_secret_123');

    // Reads return unmasked sensitive field value
    const found = await sRepo.findById(user.id);
    expect(found?.passwordHash).toBe('hashed_secret_123');
  });
  it('filters using subqueries and EXISTS conditions on real SQLite', async () => {
    db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL, status TEXT)');
    db.exec("INSERT INTO orders VALUES (10, 1, 150.0, 'shipped'), (20, 2, 50.0, 'pending')");

    const u1 = await users.create({ email: 'alice@b.com', role: 'admin' });
    await users.create({ email: 'bob@b.com', role: 'user' });

    // Subquery filtering via in
    const matchingIn = await users.find({
      id: { in: { table: 'orders', select: ['user_id'], where: { total: { gt: 100 } } } },
    });
    expect(matchingIn).toHaveLength(1);
    expect(matchingIn[0]?.id).toBe(u1.id);

    // Existence check via exists
    const matchingExists = await users.find({
      exists: { table: 'orders', where: { status: 'shipped' } },
    });
    expect(matchingExists).toHaveLength(2);
  });

  it('upsert atomically inserts or updates single record on conflict', async () => {
    // 1. First call inserts new record
    const r1 = await users.upsert({ email: 'upsert@b.com', role: 'user' }, { target: 'email' });
    expect(r1).toMatchObject({ email: 'upsert@b.com', role: 'user' });

    // 2. Second call with same unique column (email) updates the record atomically
    const r2 = await users.upsert({ email: 'upsert@b.com', role: 'admin' }, { target: 'email' });
    expect(r2).toMatchObject({ id: r1!.id, email: 'upsert@b.com', role: 'admin' });

    // 3. Verify database state
    const found = await users.findById(r1!.id);
    expect(found).toMatchObject({ id: r1!.id, email: 'upsert@b.com', role: 'admin' });
  });

  it('upsert with specific updateFields selectively updates columns on conflict', async () => {
    const r1 = await users.upsert({ email: 'selective@b.com', role: 'user' }, { target: 'email' });

    // Attempt upsert updating only role
    const r2 = await users.upsert(
      { email: 'selective@b.com', role: 'admin' },
      { target: 'email', updateFields: ['role'] },
    );
    expect(r2).toMatchObject({ id: r1!.id, email: 'selective@b.com', role: 'admin' });

    // Verify database state
    const found = await users.findById(r1!.id);
    expect(found).toMatchObject({ id: r1!.id, email: 'selective@b.com', role: 'admin' });
  });
});

// The third layer of plan D3, against a real database. `Entity<S>` says a `timestamp` is a
// `Date` and a `bigint` is a `bigint`; SQLite stores them as `TEXT` and `INTEGER`, because
// that is what the DDL emitter declares. Before this crossing existed, a `timestamp` column
// could not be written through this driver at all — `node:sqlite` refuses to bind a `Date`,
// and passing the string it wanted was the wrong type one layer up, where the validator now
// says `expected Date`.
describe('repository E2E: the db layer of a timestamp and a bigint (SQLite)', () => {
  const EventSchema = defineSchema('events', {
    id: primaryKey(serial()),
    name: notNull(text()),
    at: timestamp(),
    seq: bigint(),
    closedAt: timestamp().nullable(),
  });

  class EventRepository extends BaseRepository<typeof EventSchema> {
    static override readonly schema = EventSchema;
  }

  const ISO = '2026-01-01T12:30:00.000Z';
  let events: EventRepository;

  beforeEach(() => {
    db.exec(
      'CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, at TEXT NOT NULL, seq INTEGER NOT NULL, closedAt TEXT)',
    );
    events = new EventRepository(sqliteDriver(db), 'sqlite');
  });

  it('writes a Date and reads a Date back', async () => {
    const created = await events.create({ name: 'launch', at: new Date(ISO), seq: 7n });
    expect(created.at).toBeInstanceOf(Date);
    expect(created.at.toISOString()).toBe(ISO);

    const found = await events.findById(created.id);
    expect(found).toBeDefined();
    expect(found?.at).toBeInstanceOf(Date);
    expect(found?.at.toISOString()).toBe(ISO);
    expect(found?.seq).toBe(7n);
    expect(found?.closedAt).toBeNull();
  });

  it('stores it as the ISO-8601 text the DDL declares, which sorts chronologically', async () => {
    // Read around the repository, so this is the cell and not the decode. Fixed-width and
    // UTC is what makes `ORDER BY at` and `WHERE at > ?` mean what they say in a `TEXT`
    // column — any locale-dependent format would break both, silently.
    await events.create({ name: 'launch', at: new Date(ISO), seq: 1n });
    expect(db.prepare('SELECT at FROM events').all()).toEqual([{ at: ISO }]);
  });

  it('takes a Date in a where clause, which is a bound parameter like any other', async () => {
    await events.create({ name: 'early', at: new Date('2025-01-01T00:00:00.000Z'), seq: 1n });
    const late = await events.create({ name: 'late', at: new Date(ISO), seq: 2n });
    const found = await events.find({ at: { gt: new Date('2025-06-01T00:00:00.000Z') } });
    expect(found.map(e => e.id)).toEqual([late.id]);
  });

  it('rejects an ISO string, because that is the wire type and this is the app layer', async () => {
    await expect(
      events.create({ name: 'launch', at: ISO, seq: 1n } as unknown as Parameters<typeof events.create>[0]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
