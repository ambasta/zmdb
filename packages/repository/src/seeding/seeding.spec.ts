import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { Max, Min, MinLength, Pattern, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { makeRng, seedRows } from './index.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & MinLength<4>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  active: boolean & Sql<'boolean'>;
  role: 'admin' | 'user';
}

/** A column nothing can generate a value for, which is a refusal rather than a wrong value. */
export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  slug: string & Sql<'text'> & Pattern<'^[a-z]+$'>;
}

const { Account: AccountSchema, User: UserSchema } = schemasFrom<{ Account: Account; User: User }>(import.meta.url, [
  'User',
  'Account',
]);

describe('seeding (#138)', () => {
  it('makeRng is deterministic for a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('seedRows is reproducible for the same seed+count', () => {
    const r1 = seedRows(UserSchema, { seed: 7, count: 5 });
    const r2 = seedRows(UserSchema, { seed: 7, count: 5 });
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(5);
  });

  it('a different seed is a different dataset', () => {
    // Otherwise "reproducible" would be satisfied by a generator that ignores the seed, and
    // the assertion above would pass for a constant.
    expect(seedRows(UserSchema, { seed: 1, count: 3 })).not.toEqual(seedRows(UserSchema, { seed: 2, count: 3 }));
  });

  it('generated values respect column types; auto-inc id omitted', () => {
    const rows = seedRows(UserSchema, { seed: 1, count: 1 });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).not.toHaveProperty('id'); // serial PK omitted (CreateDTO shape)
    expect(typeof row?.email).toBe('string');
    expect(typeof row?.age).toBe('number');
    expect(typeof row?.active).toBe('boolean');
    expect(['admin', 'user']).toContain(row?.role);
  });

  it('respects the constraints, not only the types', () => {
    // What the column-map generator could not do. `age` was seeded from `Math.random() * 1e6`
    // regardless of `Min<18> & Max<120>`, so every seeded user failed the table's own
    // validator — in a test whose subject was usually something else entirely.
    for (const row of seedRows(UserSchema, { seed: 3, count: 25 })) {
      expect(row.age).toBeGreaterThanOrEqual(18);
      expect(row.age).toBeLessThanOrEqual(120);
      expect(row.email.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('refuses a column it cannot satisfy, and names it', () => {
    // Nothing inverts a regular expression. The honest answers are "refuse" and "emit a value
    // that violates the pattern"; the second is what used to happen.
    expect(() => seedRows(AccountSchema, { count: 1 })).toThrow(/slug/);
    expect(() => seedRows(AccountSchema, { count: 1 })).toThrow(/pattern/);
  });
});
