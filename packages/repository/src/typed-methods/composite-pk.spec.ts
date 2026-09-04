import type { PrimaryKeyOf } from '@zmdb/schema-core';
import { describe, it, expect } from 'vitest';

import { ValidationError } from '../index.js';
import { ProductsRepo, recorder, TenantUsersRepo, type TenantUser } from './fixtures.js';

describe('Composite Primary Key Repository Operations', () => {
  it('findById compiles parameterized multi-column SQL predicates', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10, role: 'admin' }]);
    const repo = new TenantUsersRepo(driver);
    const key: PrimaryKeyOf<TenantUser> = { tenantId: 't1', userId: 10 };
    const row = await repo.findById(key);

    const [call] = calls;
    expect(call?.text).toBe('SELECT * FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1');
    expect(call?.parameters).toEqual(['t1', 10]);
    expect(row).toEqual({ tenantId: 't1', userId: 10, role: 'admin' });
  });

  it('update compiles complete compound key predicates for composite key entities', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10, role: 'editor' }]);
    const repo = new TenantUsersRepo(driver);
    const row = await repo.update({ tenantId: 't1', userId: 10 }, { role: 'editor' });

    const [call] = calls;
    expect(call?.text).toBe(
      'UPDATE "tenant_users" SET "role" = $1 WHERE "tenantId" = $2 AND "userId" = $3 RETURNING *',
    );
    expect(call?.parameters).toEqual(['editor', 't1', 10]);
    expect(row?.role).toBe('editor');
  });

  it('delete compiles complete compound key predicates for composite key entities', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10 }]);
    const repo = new TenantUsersRepo(driver);
    const deleted = await repo.delete({ tenantId: 't1', userId: 10 });

    const [call] = calls;
    expect(call?.text).toBe(
      'DELETE FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 RETURNING "tenantId", "userId"',
    );
    expect(call?.parameters).toEqual(['t1', 10]);
    expect(deleted).toBe(true);
  });

  it('throws ValidationError at runtime when composite key is missing fields or non-object', async () => {
    const { driver } = recorder();
    const repo = new TenantUsersRepo(driver);

    // @ts-expect-error missing userId field
    await expect(repo.findById({ tenantId: 't1' })).rejects.toBeInstanceOf(ValidationError);

    // @ts-expect-error non-object key
    await expect(repo.delete('t1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('single-column key entities continue to accept scalar primary key arguments', async () => {
    const { driver, calls } = recorder([{ id: 42, name: 'Widget' }]);
    const repo = new ProductsRepo(driver);

    const product = await repo.findById(42);
    const [call0] = calls;
    expect(call0?.text).toBe('SELECT * FROM "products" WHERE "id" = $1 LIMIT 1');
    expect(call0?.parameters).toEqual([42]);
    expect(product).toEqual({ id: 42, name: 'Widget' });

    await repo.update(42, { name: 'Super Widget' });
    const call1 = calls[1];
    expect(call1?.text).toBe('UPDATE "products" SET "name" = $1 WHERE "id" = $2 RETURNING *');
    expect(call1?.parameters).toEqual(['Super Widget', 42]);

    await repo.delete(42);
    const call2 = calls[2];
    expect(call2?.text).toBe('DELETE FROM "products" WHERE "id" = $1 RETURNING "id"');
    expect(call2?.parameters).toEqual([42]);
  });
});
