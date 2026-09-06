import type { WhereDTO } from '@zmdb/schema-core/dto';
import { describe, it, expect } from 'vitest';

import { recorder, Users, type User } from './typed-methods.fixture.js';

// The method signatures these tests exercise are asserted in
// `typed-methods.type-test.ts` — this file covers the SQL and the runtime shape.
describe('typed read methods (#203)', () => {
  it('find(where: WhereDTO) compiles typed filter to SQL', async () => {
    const { driver, calls } = recorder([{ id: 1, email: 'a@b.com', age: 30, role: 'admin' }]);
    const repo = new Users(driver);
    const where: WhereDTO<User> = { role: 'admin', age: { gte: 18 } };
    const out = await repo.find(where);
    expect(calls[0]?.text).toMatch(/WHERE .*role.* = \$1 AND .*age.* >= \$2/);
    expect(calls[0]?.parameters).toEqual(['admin', 18]);
    expect(out[0]?.email).toBe('a@b.com');
  });

  it('findOne adds LIMIT 1', async () => {
    const { driver, calls } = recorder([{ id: 1, email: 'a@b.com', age: 30, role: 'admin' }]);
    const repo = new Users(driver);
    const where: WhereDTO<User> = { email: 'a@b.com' };
    await repo.findOne(where);
    expect(calls[0]?.text).toMatch(/LIMIT 1/);
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
});
