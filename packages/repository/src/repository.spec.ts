import { defineSchema, jsonEnum, serial, text, type CreateDTO } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from './index.ts';

// #25: repository CRUD + validation interception.

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});

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
      // The cast is the point: untrusted input reaching a typed API at runtime.
      // `email` missing and `role` off-enum are both compile errors now that the
      // schema comes from `defineSchema` — the validator has to catch them anyway.
      await repo.create({ role: 'nope' } as unknown as CreateDTO<typeof UserSchema>);
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
