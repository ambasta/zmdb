import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import type { CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from '../index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});
type S = typeof UserSchema;

class Users extends BaseRepository<S> {
  static override readonly schema = UserSchema;
}

// The DTO signatures these tests exercise are asserted in
// `typed-methods.type-test.ts` — this file covers validation and the driver calls.
describe('typed create/update (#206)', () => {
  it('create validates then inserts, returning the row', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ execute } as Driver);
    const dto: CreateDTO<S> = { email: 'a@b.com', age: 30 };
    const out = await repo.create(dto);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.id).toBe(1);
  });

  it('create throws ValidationError and does NOT call the driver on invalid input', async () => {
    const execute = vi.fn(async () => []);
    const repo = new Users({ execute } as Driver);
    // age missing (required, no default) → invalid. The cast is the point of the
    // test: it models untrusted input reaching a typed API at runtime, which is
    // what the validator has to catch. The compile-time half is asserted in
    // `typed-methods.type-test.ts`.
    await expect(repo.create({ email: 'a@b.com' } as unknown as CreateDTO<S>)).rejects.toBeInstanceOf(ValidationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('update validates a partial patch then updates', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 31, role: 'admin' }]);
    const repo = new Users({ execute } as Driver);
    const patch: UpdateDTO<S> = { role: 'admin' };
    const out = await repo.update(1, patch);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.role).toBe('admin');
  });
});
