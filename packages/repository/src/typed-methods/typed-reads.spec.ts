import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import type { Entity } from '@zmdb/schema-core';
import type { WhereDTO, ListResult } from '@zmdb/schema-core/dto';
import { BaseRepository, type Driver } from '../index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});
type S = typeof UserSchema;

// Recording driver: captures compiled queries, returns canned rows.
function recorder(rows: Record<string, unknown>[] = []) {
  const calls: { text: string; parameters: readonly unknown[] }[] = [];
  const driver: Driver = { execute: async (q) => (calls.push({ text: q.text, parameters: q.parameters }), rows) };
  return { driver, calls };
}

class Users extends BaseRepository<S> {
  static readonly schema = UserSchema;
}

describe('typed read methods (#203)', () => {
  it('find(where: WhereDTO) compiles typed filter to SQL', async () => {
    const { driver, calls } = recorder([{ id: 1, email: 'a@b.com', age: 30, role: 'admin' }]);
    const repo = new Users(driver);
    const out = await repo.find({ role: 'admin', age: { gte: 18 } } as WhereDTO<S>);
    expect(calls[0].text).toMatch(/WHERE .*role.* = \$1 AND .*age.* >= \$2/);
    expect(calls[0].parameters).toEqual(['admin', 18]);
    expect(out[0].email).toBe('a@b.com');
  });

  it('findOne adds LIMIT 1', async () => {
    const { driver, calls } = recorder([{ id: 1, email: 'a@b.com', age: 30, role: 'admin' }]);
    const repo = new Users(driver);
    await repo.findOne({ email: 'a@b.com' } as WhereDTO<S>);
    expect(calls[0].text).toMatch(/LIMIT 1/);
  });

  it('list returns a ListResult with hasMore trimming (limit+1)', async () => {
    // 3 rows returned for limit 2 → hasMore true, 2 items
    const { driver } = recorder([
      { id: 1, email: 'a', age: 1, role: 'user' },
      { id: 2, email: 'b', age: 2, role: 'user' },
      { id: 3, email: 'c', age: 3, role: 'user' },
    ]);
    const repo = new Users(driver);
    const res = await repo.list({ page: { limit: 2 } });
    expect(res.items).toHaveLength(2);
    expect(res.hasMore).toBe(true);
  });

  it('type-level: read methods are typed from the schema', () => {
    const repo = new Users(recorder().driver);
    expectTypeOf(repo.findById).returns.resolves.toEqualTypeOf<Entity<S> | undefined>();
    expectTypeOf(repo.findAll).returns.resolves.toEqualTypeOf<readonly Entity<S>[]>();
    expectTypeOf(repo.find).parameter(0).toEqualTypeOf<WhereDTO<S>>();
    expectTypeOf(repo.list).returns.resolves.toEqualTypeOf<ListResult<Entity<S>>>();
  });
});
