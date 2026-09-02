import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, it, expect } from 'vitest';

import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';
import { makeRng, seedRows } from './index.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  active: boolean & Sql<'boolean'>;
  role: 'admin' | 'user';
}

const { User: UserSchema } = schemasFrom(import.meta.url, ['User']);

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

  it('generated values respect column types; auto-inc id omitted', () => {
    const rows = seedRows(UserSchema, { seed: 1, count: 1 });
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? {};
    expect(row).not.toHaveProperty('id'); // serial PK omitted (CreateDTO shape)
    expect(typeof row.email).toBe('string');
    expect(typeof row.age).toBe('number');
    expect(typeof row.active).toBe('boolean');
    expect(['admin', 'user']).toContain(row.role);
  });
});
