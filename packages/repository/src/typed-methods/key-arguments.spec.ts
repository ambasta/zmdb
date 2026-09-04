import { schemaFromIR, type SchemaIR } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { BaseRepository, ValidationError } from '../index.js';
import { ProductsRepo, recorder, TenantUsersRepo } from './fixtures.js';

// What a keyed method accepts as a key, and what it says when it will not. Tests freeze for the
// epic "Composite primary keys and expression indexes" (#407 / spec freeze #408); the frozen text
// is `../../SPEC.md` §2.1.
//
// `composite-pk.spec.ts` next door already covers the half that works: a two-column key passed as
// a record compiles `WHERE "tenantId" = $1 AND "userId" = $2`, and a one-column key passed as a
// scalar compiles `WHERE "id" = $1`. None of that is repeated here. This file covers the three
// things §2.1 freezes that are not true yet — the wording of the refusals, the method name in
// them, and which arguments are refused at all — because each of the gaps is a query that runs
// and returns or changes the wrong rows rather than an error anybody sees.
//
// `it.fails` for the frozen claims, with the current output recorded above each one. See
// `@zmdb/query-compiler`'s `src/migrations/composite-keys.spec.ts` for why `it.fails` rather than
// `.skip` or a stub.

/**
 * A table with no primary key, which `schema-core/src/ir/SPEC.md` §4.1 says is legal IR.
 *
 * Built from IR rather than from a tagged interface on purpose: `schemasFrom` goes through
 * `@zmdb/aot-validator`'s reflector, and that refuses a table with no `PrimaryKey` column
 * outright, so there is no way to declare this shape in TypeScript today. Since §4.1 freezes the
 * shape as legal, the repository's behaviour for it is asserted from the IR the reflector will
 * eventually be able to produce. That contradiction is itself a finding, not a workaround.
 */
const keylessIr: SchemaIR = {
  table: 'audit_log',
  physicalTable: 'audit_log',
  columns: [
    {
      name: 'at',
      physicalName: 'at',
      sql: 'timestamp',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'what',
      physicalName: 'what',
      sql: 'text',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
    },
  ],
  primaryKey: [],
  relations: [],
  foreignKeys: [],
};

/** The keyless schema as a repository. `never` because no tagged interface can describe it yet. */
class AuditLogRepo extends BaseRepository<never> {
  static override readonly schema = schemaFromIR(keylessIr);
}

describe('composite key refusals (frozen: repository/SPEC.md 2.1)', () => {
  // §2.1 freezes `<table>.<method> requires every key column; missing: <cols>`. The table and the
  // method are both in it because the caller has neither in hand otherwise: a repository method
  // is called on a variable, and "schema tenant_users" is the schema's name for itself.
  //
  // actual today:
  //   ValidationError: missing composite primary key column "userId" for schema tenant_users
  // — the right class and the right column, in wording that names neither the method nor the
  // table the way the caller wrote them.
  it.fails('names the table, the method and the missing column', async () => {
    const { driver, calls } = recorder();
    const repo = new TenantUsersRepo(driver);

    // @ts-expect-error frozen (SPEC.md 2.1): half a key is not a `PrimaryKeyOf<TenantUser>`, which
    // is the compile-time half of this claim - the runtime check is for the untyped caller.
    const half = repo.findById({ tenantId: 't1' });
    await expect(half).rejects.toBeInstanceOf(ValidationError);
    await expect(half).rejects.toThrow('tenant_users.findById requires every key column; missing: userId');
    // "before any SQL is compiled" is the other half of the rule, and it holds today.
    expect(calls).toEqual([]);
  });

  // Every missing column, in key order — not the first one the loop tripped over. A caller who
  // passed `{}` gets told once what the key is instead of discovering it a column per round trip,
  // and key order rather than object iteration order is what makes the message a function of the
  // call.
  //
  // actual today:
  //   ValidationError: missing composite primary key column "tenantId" for schema tenant_users
  // — one column, and it is the first in key order only because the loop happens to run in that
  // order; nothing states it.
  it.fails('lists every missing key column in key order', async () => {
    const { driver } = recorder();
    const repo = new TenantUsersRepo(driver);

    // @ts-expect-error frozen (SPEC.md 2.1): no key columns at all.
    const none = repo.findById({});
    await expect(none).rejects.toThrow('tenant_users.findById requires every key column; missing: tenantId, userId');
  });

  // The method in the message is the one the caller called. `buildKeyWhere` is the private helper
  // all three funnel through and it is not in anybody's vocabulary, so the name has to be passed
  // in rather than read off the stack.
  //
  // actual today, for all three: the same string with no method in it at all —
  //   ValidationError: missing composite primary key column "tenantId" for schema tenant_users
  // (from `update`) and ... column "userId" ... (from `delete`). Two different methods, one
  // message, and nothing in it to tell them apart.
  it.fails('names update and delete as themselves, not the shared helper', async () => {
    const { driver } = recorder();
    const repo = new TenantUsersRepo(driver);

    // @ts-expect-error frozen (SPEC.md 2.1): half a key on update.
    const patched = repo.update({ userId: 10 }, { role: 'editor' });
    await expect(patched).rejects.toThrow('tenant_users.update requires every key column; missing: tenantId');

    // @ts-expect-error frozen (SPEC.md 2.1): half a key on delete.
    const removed = repo.delete({ tenantId: 't1' });
    await expect(removed).rejects.toThrow('tenant_users.delete requires every key column; missing: userId');
  });

  // A non-object argument gets the same class and a message that says what arrived and what the
  // key is, because "requires an object map" leaves the caller to go and read the schema to find
  // out which columns.
  //
  // actual today, for both the number and the `Date`:
  //   ValidationError: composite primary key for schema tenant_users requires an object map
  it.fails('says what arrived and what the key is, for a non-object key', async () => {
    const { driver } = recorder();
    const repo = new TenantUsersRepo(driver);

    // @ts-expect-error frozen (SPEC.md 2.1): a scalar is not a composite key.
    const scalar = repo.findById(42);
    await expect(scalar).rejects.toBeInstanceOf(ValidationError);
    await expect(scalar).rejects.toThrow(
      'tenant_users.findById requires every key column; got a number, expected an object with (tenantId, userId)',
    );

    // A `Date` is an object and is excluded by name, since it is the one built-in that a caller
    // plausibly holds a key-shaped value in and that has no key columns on it.
    // @ts-expect-error frozen (SPEC.md 2.1): a Date is not a composite key either.
    const date = repo.findById(new Date(0));
    await expect(date).rejects.toThrow(
      'tenant_users.findById requires every key column; got a Date, expected an object with (tenantId, userId)',
    );
  });

  // Extra keys are ignored: a caller who has a whole entity in hand passes it. This holds today
  // and §2.1 keeps it, so it is asserted green rather than red.
  it('ignores keys that are not part of the key', async () => {
    const { driver, calls } = recorder([{ tenantId: 't1', userId: 10, role: 'admin' }]);
    const repo = new TenantUsersRepo(driver);

    await repo.findById({ tenantId: 't1', userId: 10, role: 'admin' } as never);
    expect(calls[0]?.text).toBe('SELECT * FROM "tenant_users" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1');
    expect(calls[0]?.parameters).toEqual(['t1', 10]);
  });
});

describe('a keyless table (frozen: repository/SPEC.md 2.1)', () => {
  // The first of §2.1's three rules, and the one that already holds: a keyed method on a keyless
  // table throws and the message names the table. Asserted green so that the slice which rewrites
  // `buildKeyWhere` for the other two rules does not lose it.
  //
  // The class is deliberately not asserted. Today it is a bare `Error` while §2.1's other two
  // refusals are `ValidationError`s, and the frozen text says only "throws, naming the table" —
  // so pinning `Error` here would freeze an inconsistency the spec did not decide.
  it('throws from every keyed method, naming the table', async () => {
    const { driver, calls } = recorder();
    const repo = new AuditLogRepo(driver);

    await expect(repo.findById(1 as never)).rejects.toThrow('audit_log');
    await expect(repo.update(1 as never, {})).rejects.toThrow('audit_log');
    await expect(repo.delete(1 as never)).rejects.toThrow('audit_log');
    expect(calls).toEqual([]);
  });

  // And the unkeyed read still works on it, because "these three methods do not apply" is the
  // whole of the restriction.
  it('still reads every row', async () => {
    const { driver, calls } = recorder([]);
    const repo = new AuditLogRepo(driver);

    expect(await repo.findAll()).toEqual([]);
    expect(calls[0]?.text).toBe('SELECT * FROM "audit_log"');
  });
});

describe('a one-column key takes the value, not a record (frozen: repository/SPEC.md 2.1)', () => {
  // The rule with teeth. §2.1: "`{ id: 1 }` is _not_ accepted as a courtesy" — and the reason is
  // not tidiness. `buildKeyWhere` builds `{ [pkCol]: id }` for a one-column key, so the record
  // form produces the nested `{ id: { id: 42 } }`, which `compileWhere` reads as an operator map,
  // finds no operator in, and emits nothing for. The predicate does not become wrong; it
  // disappears.
  //
  // Was red. Before #608, `findById({ id: 42 })` compiled
  //   SELECT * FROM "products" LIMIT 1
  // with no parameters and returned the first row of the table, whatever it was. The
  // single-column branch of `buildKeyWhere` now refuses a non-scalar key.
  it('refuses the record form on findById instead of dropping the predicate', async () => {
    const { driver, calls } = recorder([{ id: 42, name: 'Widget' }]);
    const repo = new ProductsRepo(driver);

    // @ts-expect-error frozen (SPEC.md 2.1): `PrimaryKeyOf<Product>` is `number`.
    const found = repo.findById({ id: 42 });
    await expect(found).rejects.toBeInstanceOf(ValidationError);
    await expect(found).rejects.toThrow('products.findById requires the value of "id", not an object');
    expect(calls).toEqual([]);
  });

  // The same hole on the two methods that write. This is the assertion this file exists for: an
  // `UPDATE` and a `DELETE` whose `WHERE` vanished are not a wrong answer, they are the whole
  // table.
  //
  // Was red. Before #608 neither threw and neither had a predicate:
  //   update({ id: 42 }, { name: 'x' }) -> UPDATE "products" SET "name" = $1 RETURNING *
  //   delete({ id: 42 })                -> DELETE FROM "products" RETURNING "id"
  // Both were run to get those strings. The first rewrote every row in `products`; the second
  // emptied it. Two things stop it now: the key check below, and `assertKeyed`, which refuses a
  // compiled `UPDATE`/`DELETE` with no `WHERE` whatever produced it.
  it('refuses the record form on update and delete rather than losing the WHERE', async () => {
    const patch = recorder([{ id: 42, name: 'Widget' }]);
    const patchRepo = new ProductsRepo(patch.driver);
    // @ts-expect-error frozen (SPEC.md 2.1): `PrimaryKeyOf<Product>` is `number`.
    const patched = patchRepo.update({ id: 42 }, { name: 'Super Widget' });
    await expect(patched).rejects.toThrow('products.update requires the value of "id", not an object');
    expect(patch.calls, 'an UPDATE with no WHERE must never be compiled').toEqual([]);

    const remove = recorder([{ id: 42 }]);
    const removeRepo = new ProductsRepo(remove.driver);
    // @ts-expect-error frozen (SPEC.md 2.1): `PrimaryKeyOf<Product>` is `number`.
    const removed = removeRepo.delete({ id: 42 });
    await expect(removed).rejects.toThrow('products.delete requires the value of "id", not an object');
    expect(remove.calls, 'a DELETE with no WHERE must never be compiled').toEqual([]);
  });
});

describe('pkColumn is not a fallback (frozen: repository/SPEC.md 2.1)', () => {
  // §2.1: "`pkColumn` (the private getter that returns `primaryKey[0]`) ... must not survive as a
  // fallback." `list` is the fourth reader of it, and the one §2.1's own list of methods does not
  // name — so it is asserted here or it is found in production.
  //
  // `list` orders by the key so that a page boundary is deterministic, and encodes the ordering
  // columns into the cursor. With `primaryKey[0]` both of those are one column of a two-column
  // key, and `(tenantId)` is not unique — so the ordering has ties and the cursor cannot say
  // which side of a tie it was on.
  //
  // actual today, both statements run to get these strings:
  //   page 1  SELECT * FROM "tenant_users" ORDER BY "tenantId" ASC LIMIT 3
  //           cursor "eyJ0ZW5hbnRJZCI6InQxIn0", which is base64 of {"tenantId":"t1"}
  //   page 2  SELECT * FROM "tenant_users" WHERE "tenantId" > $1 ORDER BY "tenantId" ASC LIMIT 3
  //           parameters ["t1"]
  // Page 2 asks for a *later tenant*, so every remaining row of tenant "t1" - row 3 of the 3 in
  // this fixture - is skipped and never appears on any page.
  it.fails('orders and cursors by every key column, so no row is skipped between pages', async () => {
    const rows = [
      { tenantId: 't1', userId: 10, role: 'admin' },
      { tenantId: 't1', userId: 11, role: 'user' },
      { tenantId: 't1', userId: 12, role: 'user' },
    ];
    const { driver, calls } = recorder(rows);
    const repo = new TenantUsersRepo(driver);

    const page1 = await repo.list({ page: { limit: 2 } });
    expect(calls[0]?.text).toBe('SELECT * FROM "tenant_users" ORDER BY "tenantId" ASC, "userId" ASC LIMIT 3');
    expect(page1.hasMore).toBe(true);

    // boundary: `cursor` is opaque to the caller by design, so the assertion is on what the next
    // page *asks for* rather than on the cursor's bytes.
    await repo.list({ page: { limit: 2, after: page1.cursor } });
    expect(calls[1]?.text).toBe(
      'SELECT * FROM "tenant_users" WHERE ("tenantId", "userId") > ($1, $2) ORDER BY "tenantId" ASC, "userId" ASC LIMIT 3',
    );
    expect(calls[1]?.parameters).toEqual(['t1', 11]);
  });
});
