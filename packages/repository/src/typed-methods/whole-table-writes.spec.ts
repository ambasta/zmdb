import { describe, it, expect } from 'vitest';

import { ValidationError } from '../index.js';
import { ProductsRepo, recorder, TenantUsersRepo } from './typed-methods.fixture.js';

// #608 — a keyed write whose `WHERE` disappeared.
//
// `update` and `delete` build their predicate from a primary key, hand it to `compileWhere`
// and execute whatever comes back. Every step of that was correct in isolation and the
// composition was not: `compileWhere` folded a where-spec it found no operator in down to
// nothing, so an `UPDATE` or a `DELETE` came out of the compiler with no `WHERE` at all and
// the driver ran it against the whole table. There is no error to see, and no row is missing
// — every row is changed.
//
// The three checks that stop it are asserted here in the order a bad call meets them:
//
//   1. `keyWhere` refuses a non-scalar single-column key (`key-arguments.spec.ts` owns
//      the wording, which `repository/SPEC.md` §2.1 freezes).
//   2. `compileWhere` refuses an empty operator map (`schema-core`'s `dto/where.spec.ts`).
//   3. `assertKeyed` refuses the compiled statement itself. This one is the backstop and the
//      reason this file exists separately: it holds for a fourth way of folding a spec down
//      to nothing that nobody has thought of yet.
//
// The assertion throughout is the recorder having **zero** calls, not the SQL text. A test
// that checks the text of a statement that must never be compiled has already lost.

describe('update and delete never compile a statement without a WHERE (#608)', () => {
  it('refuses an object where a one-column key belongs, on update', async () => {
    const { driver, calls } = recorder([{ id: 42, name: 'Widget' }]);
    const repo = new ProductsRepo(driver);

    // @ts-expect-error the point of the test: `PrimaryKeyOf<Product>` is `number`, so this is
    // the untyped caller — a route handler that passed a parsed request body straight through.
    const patched = repo.update({ id: 42 }, { name: 'Super Widget' });

    await expect(patched).rejects.toBeInstanceOf(ValidationError);
    expect(calls, 'an UPDATE with no WHERE must never reach the driver').toEqual([]);
  });

  it('refuses an object where a one-column key belongs, on delete', async () => {
    const { driver, calls } = recorder([{ id: 42 }]);
    const repo = new ProductsRepo(driver);

    // @ts-expect-error as above: this is what arrives when nobody typed the boundary.
    const removed = repo.delete({ id: 42 });

    await expect(removed).rejects.toBeInstanceOf(ValidationError);
    expect(calls, 'a DELETE with no WHERE must never reach the driver').toEqual([]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [42]],
    ['an empty object', {}],
  ])('refuses %s as a one-column key on both writes', async (_what, key) => {
    const patch = recorder();
    // @ts-expect-error every one of these is outside `PrimaryKeyOf<Product>`.
    await expect(new ProductsRepo(patch.driver).update(key, { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    expect(patch.calls).toEqual([]);

    const remove = recorder();
    // @ts-expect-error same set, on the method that empties the table.
    await expect(new ProductsRepo(remove.driver).delete(key)).rejects.toBeInstanceOf(ValidationError);
    expect(remove.calls).toEqual([]);
  });

  it('refuses an empty patch with a bad key as update rather than delegating to findById', async () => {
    // `update(id, {})` has nothing to set and answers with the current row, which is a read.
    // The key is checked before that shortcut, so the message names the method the caller
    // called — and, more to the point, the shortcut cannot become a second unguarded path.
    const { driver, calls } = recorder([{ id: 42, name: 'Widget' }]);
    const repo = new ProductsRepo(driver);

    // @ts-expect-error the untyped caller again, this time with nothing to write.
    const patched = repo.update({ id: 42 }, {});

    await expect(patched).rejects.toThrow('products.update requires the value of "id", not an object');
    expect(calls).toEqual([]);
  });

  it('still writes when the key is a value, on a one-column key', async () => {
    // The control for all of the above: the guard is not simply refusing every write.
    const patch = recorder([{ id: 42, name: 'Super Widget' }]);
    await new ProductsRepo(patch.driver).update(42, { name: 'Super Widget' });
    expect(patch.calls[0]?.text).toBe('UPDATE "products" SET "name" = $1 WHERE "id" = $2 RETURNING *');
    expect(patch.calls[0]?.parameters).toEqual(['Super Widget', 42]);

    const remove = recorder([{ id: 42 }]);
    expect(await new ProductsRepo(remove.driver).delete(42)).toBe(true);
    expect(remove.calls[0]?.text).toBe('DELETE FROM "products" WHERE "id" = $1 RETURNING "id"');
    expect(remove.calls[0]?.parameters).toEqual([42]);
  });

  it('still writes when every column of a composite key is present', async () => {
    // The composite branch already refused a missing column, so it was never the hole — but
    // it goes through the same `assertKeyed`, and a guard that broke the working path would
    // be a worse bug than the one it fixes.
    const patch = recorder([{ tenantId: 't1', userId: 10, role: 'editor' }]);
    await new TenantUsersRepo(patch.driver).update({ tenantId: 't1', userId: 10 }, { role: 'editor' });
    expect(patch.calls[0]?.text).toBe(
      'UPDATE "tenant_users" SET "role" = $1 WHERE "tenantId" = $2 AND "userId" = $3 RETURNING *',
    );

    const remove = recorder([{ tenantId: 't1', userId: 10 }]);
    expect(await new TenantUsersRepo(remove.driver).delete({ tenantId: 't1', userId: 10 })).toBe(true);
    expect(remove.calls[0]?.text).toBe(
      'DELETE FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 RETURNING "tenantId", "userId"',
    );
  });

  it('emits a WHERE for every key form a write accepts', async () => {
    // `assertKeyed` is the third check and, with the first two in place, nothing reaches it:
    // a scalar key always folds to one predicate, and every other argument is refused before
    // the compiler runs. That is the intended state, not a reason to delete it — the check
    // costs one regular expression per write and it is what makes "the whole table" a thrown
    // error rather than a fourth composition nobody audited.
    //
    // What is assertable is the invariant it enforces: sweep every key form the two writing
    // methods accept and assert the compiled text, since a statement with no `WHERE` is the
    // one outcome that must not exist regardless of which check would have caught it.
    const compiled: { what: string; text: string }[] = [];

    const number = recorder([{ id: 1, name: 'a' }]);
    await new ProductsRepo(number.driver).update(1, { name: 'a' });
    compiled.push({ what: 'update by number', text: number.calls[0]?.text ?? '' });

    const numberDelete = recorder([{ id: 1 }]);
    await new ProductsRepo(numberDelete.driver).delete(1);
    compiled.push({ what: 'delete by number', text: numberDelete.calls[0]?.text ?? '' });

    const empty = recorder([{ id: 1, name: 'a' }]);
    await new ProductsRepo(empty.driver).update(1, {});
    // An empty patch is a read, and it is in the sweep because it is the one keyed call that
    // does not compile a write at all — so "no WHERE" would be invisible in it.
    compiled.push({ what: 'update with an empty patch', text: empty.calls[0]?.text ?? '' });

    const composite = recorder([{ tenantId: 't1', userId: 10, role: 'admin' }]);
    await new TenantUsersRepo(composite.driver).update({ tenantId: 't1', userId: 10 }, { role: 'admin' });
    compiled.push({ what: 'update by composite key', text: composite.calls[0]?.text ?? '' });

    const compositeDelete = recorder([{ tenantId: 't1', userId: 10 }]);
    await new TenantUsersRepo(compositeDelete.driver).delete({ tenantId: 't1', userId: 10 });
    compiled.push({ what: 'delete by composite key', text: compositeDelete.calls[0]?.text ?? '' });

    expect(compiled).toHaveLength(5);
    for (const { what, text } of compiled) {
      expect(text, `${what} compiled a statement with no WHERE`).toMatch(/\sWHERE\s/);
    }
  });
});
