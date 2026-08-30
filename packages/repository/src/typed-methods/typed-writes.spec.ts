import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import { BaseRepository, ValidationError, type Driver } from '../index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});
type S = typeof UserSchema;

class Users extends BaseRepository<S> {
  static readonly schema = UserSchema;
}

describe('typed create/update (#206)', () => {
  it('create validates then inserts, returning the row', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ execute } as Driver);
    const out = await repo.create({ email: 'a@b.com', age: 30 } as CreateDTO<S>);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.id).toBe(1);
  });

  it('create throws ValidationError and does NOT call the driver on invalid input', async () => {
    const execute = vi.fn(async () => []);
    const repo = new Users({ execute } as Driver);
    // age missing (required, no default) → invalid
    await expect(repo.create({ email: 'a@b.com' } as unknown as CreateDTO<S>)).rejects.toBeInstanceOf(ValidationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('update validates a partial patch then updates', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 31, role: 'admin' }]);
    const repo = new Users({ execute } as Driver);
    const out = await repo.update(1, { role: 'admin' } as UpdateDTO<S>);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.role).toBe('admin');
  });

  it('type-level: create/update accept the derived DTOs and return Entity', () => {
    const repo = new Users({ execute: async () => [] } as Driver);
    expectTypeOf(repo.create).parameter(0).toEqualTypeOf<CreateDTO<S>>();
    expectTypeOf(repo.create).returns.resolves.toEqualTypeOf<Entity<S>>();
    expectTypeOf(repo.update).parameter(1).toEqualTypeOf<UpdateDTO<S>>();
    expectTypeOf(repo.update).returns.resolves.toEqualTypeOf<Entity<S> | undefined>();
  });
});
