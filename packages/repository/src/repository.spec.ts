import {
  defineSchema,
  integer,
  json,
  jsonEnum,
  serial,
  text,
  timestamp,
  varchar,
  type CreateDTO,
  type ValidationIssue,
} from '@zmdb/schema-core';
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
    // The issues come from the shared runtime walker now, not from a walk this package
    // owned, so they read the way every other zmdb validator's do — and say more: the
    // enum column reports the values it will accept, where `expected: 'jsonEnum'` named
    // the column type and left the caller to go and look them up.
    expect(error?.issues).toEqual([
      { path: 'input.email', message: 'expected string', expected: 'string', value: undefined },
      { path: 'input.role', message: 'expected "admin" | "user"', expected: '"admin" | "user"', value: 'nope' },
    ]);
  });
});

// What a write now checks, and did not before. The walk this package used to own knew
// nothing about a bound or a pattern — so a schema's `Min<18>` was enforced at the HTTP
// edge by a different validator and nowhere else, and a write that went straight to a
// repository skipped it — and it accepted `Date | string` for a `timestamp`, so neither
// of the column's two types was ever the one being checked.
describe('BaseRepository write validation, through the IR', () => {
  const AccountSchema = defineSchema('accounts', {
    id: serial().primaryKey(),
    email: varchar(32).validate({ kind: 'pattern', value: '^\\S+@\\S+$' }),
    age: integer().validate({ kind: 'minimum', value: 18 }).validate({ kind: 'maximum', value: 120 }),
    createdAt: timestamp(),
    settings: json(),
  });

  class AccountRepository extends BaseRepository<typeof AccountSchema> {
    static override readonly schema = AccountSchema;
  }

  const valid = {
    email: 'a@b.co',
    age: 30,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    settings: { theme: 'dark' },
  };

  // The cast on every call is the same one the test above explains: these are compile
  // errors in `CreateDTO`, and the runtime check is what stands between the database and
  // input that never went through the compiler.
  async function rejects(patch: Record<string, unknown>): Promise<readonly ValidationIssue[]> {
    const driver = fakeDriver();
    const repo = new AccountRepository(driver);
    const payload = { ...valid, ...patch } as unknown as CreateDTO<typeof AccountSchema>;
    try {
      await repo.create(payload);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      expect(driver.calls.length).toBe(0);
      return e.issues;
    }
    throw new Error('expected the payload to be rejected');
  }

  it('accepts the payload every column is happy with', async () => {
    const driver = fakeDriver([{ id: 1, ...valid }]);
    const repo = new AccountRepository(driver);
    await repo.create(valid as unknown as CreateDTO<typeof AccountSchema>);
    expect(driver.calls.length).toBe(1);
  });

  it('enforces the bounds the schema declares', async () => {
    expect(await rejects({ age: 17 })).toEqual([
      { path: 'input.age', message: 'expected minimum 18', expected: 'minimum 18', value: 17 },
    ]);
    expect(await rejects({ age: 121 })).toEqual([
      { path: 'input.age', message: 'expected maximum 120', expected: 'maximum 120', value: 121 },
    ]);
  });

  it('enforces a pattern, and the length a varchar implies', async () => {
    expect(await rejects({ email: 'nope' })).toEqual([
      {
        path: 'input.email',
        message: 'expected pattern ^\\S+@\\S+$',
        expected: 'pattern ^\\S+@\\S+$',
        value: 'nope',
      },
    ]);
    const long = `${'a'.repeat(40)}@b.co`;
    expect(await rejects({ email: long })).toEqual([
      { path: 'input.email', message: 'expected maxLength 32', expected: 'maxLength 32', value: long },
    ]);
  });

  it('wants the app type of a timestamp, not the wire type', async () => {
    // An ISO string is what arrives in a request body, and it is wrong here: a caller at
    // this layer has decoded the body and holds a `Date`. The old check took either, which
    // is how `Entity<S>` saying `Date` and the document saying `string` went unnoticed.
    expect(await rejects({ createdAt: '2026-01-01T00:00:00.000Z' })).toEqual([
      { path: 'input.createdAt', message: 'expected Date', expected: 'Date', value: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('still says the one thing it knows about a json column', async () => {
    // `json()` erases its payload type, so the check is "not a primitive" — which is what
    // it has always been, and it survives the move to the shared walker.
    expect(await rejects({ settings: 123 })).toEqual([
      { path: 'input.settings', message: 'expected object | array', expected: 'object | array', value: 123 },
    ]);
    const driver = fakeDriver([{ id: 1 }]);
    await new AccountRepository(driver).create({
      ...valid,
      settings: [1, 2],
    } as unknown as CreateDTO<typeof AccountSchema>);
    expect(driver.calls.length).toBe(1);
  });
});

// REQ-RP-3. Both of these were dropped in silence: `bogus` disappeared, and a supplied
// `id` on a serial key was ignored, so the insert went through with the database about to
// generate the value the caller thought they had chosen.
describe('BaseRepository rejects a key the write does not accept', () => {
  const valid = { email: 'a@b.com', role: 'user' as const };

  async function createRejects(patch: Record<string, unknown>): Promise<readonly ValidationIssue[]> {
    const driver = fakeDriver();
    const repo = new UserRepository(driver);
    try {
      await repo.create({ ...valid, ...patch } as unknown as CreateDTO<typeof UserSchema>);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      expect(driver.calls.length).toBe(0);
      return e.issues;
    }
    throw new Error('expected the payload to be rejected');
  }

  it('names an unknown key rather than dropping it', async () => {
    expect(await createRejects({ bogus: 1 })).toEqual([
      {
        path: 'input.bogus',
        message: '"bogus" is not a column of "users"',
        expected: 'no excess properties',
        value: 1,
      },
    ]);
  });

  it('refuses a database-generated column on insert', async () => {
    expect(await createRejects({ id: 5 })).toEqual([
      {
        path: 'input.id',
        message: 'the database generates "id", so a payload cannot supply it',
        expected: 'no excess properties',
        value: 5,
      },
    ]);
  });

  it('reports the misspelling next to the column it was meant to be', async () => {
    // Why this is reported alongside the structural issues instead of only when there are
    // none, which is the rule `assertEquals` follows. "`email` is missing" on its own
    // sends you looking at the wrong thing.
    expect(await createRejects({ email: undefined, emial: 'a@b.com' })).toEqual([
      { path: 'input.email', message: 'expected string', expected: 'string', value: undefined },
      {
        path: 'input.emial',
        message: '"emial" is not a column of "users"',
        expected: 'no excess properties',
        value: 'a@b.com',
      },
    ]);
  });

  it('refuses a key column in a patch, which identifies the row instead', async () => {
    // A patch body says what to change, and the URL says which row — so a key in the body
    // is either redundant or an attempt to move the row. Spelled out for a non-serial key,
    // because that is the one the create path would have allowed.
    const Tenants = defineSchema('tenants', { slug: text().primaryKey(), name: text() });
    class TenantRepository extends BaseRepository<typeof Tenants> {
      static override readonly schema = Tenants;
    }
    const driver = fakeDriver();
    const repo = new TenantRepository(driver);
    let error: ValidationError | undefined;
    try {
      await repo.update('acme', { slug: 'acme-2' } as unknown as Parameters<typeof repo.update>[1]);
    } catch (e) {
      if (e instanceof ValidationError) error = e;
    }
    expect(driver.calls.length).toBe(0);
    expect(error?.issues).toEqual([
      {
        path: 'input.slug',
        message: '"slug" identifies the row and cannot be patched',
        expected: 'no excess properties',
        value: 'acme-2',
      },
    ]);
    // And it is accepted on insert, where it is the caller's to choose.
    const insert = fakeDriver([{ slug: 'acme', name: 'Acme' }]);
    await new TenantRepository(insert).create({ slug: 'acme', name: 'Acme' });
    expect(insert.calls.length).toBe(1);
  });

  it('leaves an explicitly undefined key alone, so a spread still works', async () => {
    // `{ ...patch, role: undefined }` is how optional fields get built, and it means "not
    // supplied" — which is not the same as supplying a key that does not exist.
    const driver = fakeDriver([{ id: 1, ...valid }]);
    const repo = new UserRepository(driver);
    await repo.create({ ...valid, bogus: undefined } as unknown as CreateDTO<typeof UserSchema>);
    expect(driver.calls.length).toBe(1);
  });
});

describe('BaseRepository delete', () => {
  it('delete compiles a DELETE and reports success', async () => {
    const driver = fakeDriver([{ id: 1 }]);
    const repo = new UserRepository(driver);
    expect(await repo.delete(1)).toBe(true);
  });
});
