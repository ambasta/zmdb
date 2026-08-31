import type { CoreSchema } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from './index.ts';

// RED PHASE (#25 spec freeze): repository CRUD + validation interception.

// A hand-built schema literal (defineSchema is itself unimplemented).
const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    email: { type: 'text', flags: { nullable: false } },
    role: { type: 'jsonEnum', flags: { nullable: false, enum: ['admin', 'user'] } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}

function fakeDriver(rows: Record<string, unknown>[] = []): Driver & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    execute: vi.fn(async q => {
      calls.push(q);
      return rows;
    }),
  };
}

describe('BaseRepository read methods', () => {
  it('findById compiles a SELECT and maps the row', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const user = await repo.findById(1);
    expect(user).toEqual({ id: 1, email: 'a@b.com', role: 'user' });
    expect(driver.calls.length).toBe(1);
  });

  it('findAll returns plain objects (no proxy)', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(Object.getPrototypeOf(all[0])).toBe(Object.prototype);
  });
});

describe('BaseRepository create/update validation interception', () => {
  it('valid create executes an INSERT', async () => {
    const driver = fakeDriver([{ id: 1, email: 'a@b.com', role: 'user' }]);
    const repo = new UserRepository(driver);
    const created = await repo.create({ email: 'a@b.com', role: 'user' });
    expect(created).toEqual({ id: 1, email: 'a@b.com', role: 'user' });
  });

  it('invalid create throws ValidationError and executes NO SQL', async () => {
    const driver = fakeDriver();
    const repo = new UserRepository(driver);
    let error: ValidationError | undefined;
    try {
      await repo.create({ role: 'nope' });
    } catch (e) {
      if (e instanceof ValidationError) error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(driver.calls.length).toBe(0);
    expect(error?.issues).toEqual([
      { path: 'input.email', message: 'missing required field "email"', expected: 'defined', value: undefined },
      { path: 'input.role', message: 'invalid value for "role"', expected: 'jsonEnum', value: 'nope' },
    ]);
  });
});

describe('BaseRepository delete', () => {
  it('delete compiles a DELETE and reports success', async () => {
    const driver = fakeDriver([{ id: 1 }]);
    const repo = new UserRepository(driver);
    expect(await repo.delete(1)).toBe(true);
  });
});
