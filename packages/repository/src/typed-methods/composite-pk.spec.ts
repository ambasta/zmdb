import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, text, integer, primaryKey } from '@zmdb/schema-core';
import type { PrimaryKey } from '@zmdb/schema-core';
import { BaseRepository, ValidationError, type Driver } from '../index.ts';

const CompositeSchema = defineSchema('tenant_users', {
  tenantId: primaryKey(text()),
  userId: primaryKey(integer()),
  role: text().notNull(),
});
type CompositeS = typeof CompositeSchema;

const SinglePkSchema = defineSchema('products', {
  id: primaryKey(integer()),
  name: text().notNull(),
});
type SingleS = typeof SinglePkSchema;

function recorder(rows: Record<string, unknown>[] = []) {
  const calls: { text: string; parameters: readonly unknown[] }[] = [];
  const driver: Driver = { execute: async (q) => (calls.push({ text: q.text, parameters: q.parameters }), rows) };
  return { driver, calls };
}

class TenantUsersRepo extends BaseRepository<CompositeS> {
  static override readonly schema = CompositeSchema;
}

class ProductsRepo extends BaseRepository<SingleS> {
  static override readonly schema = SinglePkSchema;
}

describe('Composite Primary Key Repository Operations', () => {
  it('findById compiles parameterized multi-column SQL predicates', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10, role: 'admin' }]);
    const repo = new TenantUsersRepo(driver);
    const key: PrimaryKey<CompositeS> = { tenantId: 't1', userId: 10 };
    const row = await repo.findById(key);

    expect(calls[0].text).toBe(
      'SELECT * FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1',
    );
    expect(calls[0].parameters).toEqual(['t1', 10]);
    expect(row).toEqual({ tenantId: 't1', userId: 10, role: 'admin' });
  });

  it('update compiles complete compound key predicates for composite key entities', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10, role: 'editor' }]);
    const repo = new TenantUsersRepo(driver);
    const row = await repo.update({ tenantId: 't1', userId: 10 }, { role: 'editor' });

    expect(calls[0].text).toBe(
      'UPDATE "tenant_users" SET "role" = $1 WHERE "tenantId" = $2 AND "userId" = $3 RETURNING *',
    );
    expect(calls[0].parameters).toEqual(['editor', 't1', 10]);
    expect(row?.role).toBe('editor');
  });

  it('delete compiles complete compound key predicates for composite key entities', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10 }]);
    const repo = new TenantUsersRepo(driver);
    const deleted = await repo.delete({ tenantId: 't1', userId: 10 });

    expect(calls[0].text).toBe(
      'DELETE FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 RETURNING "tenantId", "userId"',
    );
    expect(calls[0].parameters).toEqual(['t1', 10]);
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
    expect(calls[0].text).toBe('SELECT * FROM "products" WHERE "id" = $1 LIMIT 1');
    expect(calls[0].parameters).toEqual([42]);
    expect(product).toEqual({ id: 42, name: 'Widget' });

    await repo.update(42, { name: 'Super Widget' });
    expect(calls[1].text).toBe(
      'UPDATE "products" SET "name" = $1 WHERE "id" = $2 RETURNING *',
    );
    expect(calls[1].parameters).toEqual(['Super Widget', 42]);

    await repo.delete(42);
    expect(calls[2].text).toBe('DELETE FROM "products" WHERE "id" = $1 RETURNING "id"');
    expect(calls[2].parameters).toEqual([42]);
  });

  it('type-level: enforces composite key object map and scalar single key types', () => {
    const compRepo = new TenantUsersRepo(recorder().driver);
    expectTypeOf(compRepo.findById).parameter(0).toEqualTypeOf<{ tenantId: string; userId: number }>();
    expectTypeOf(compRepo.delete).parameter(0).toEqualTypeOf<{ tenantId: string; userId: number }>();

    const prodRepo = new ProductsRepo(recorder().driver);
    expectTypeOf(prodRepo.findById).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(prodRepo.delete).parameter(0).toEqualTypeOf<number>();
  });
});
