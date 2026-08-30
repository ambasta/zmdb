import { describe, it, expect } from 'vitest';

import { defineSchema, serial, text, integer, boolean, jsonEnum } from '../index.ts';
import { makeRng, seedRows } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  active: boolean().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});

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
    const [row] = seedRows(UserSchema, { seed: 1, count: 1 });
    expect(row).not.toHaveProperty('id'); // serial PK omitted (CreateDTO shape)
    expect(typeof row.email).toBe('string');
    expect(typeof row.age).toBe('number');
    expect(typeof row.active).toBe('boolean');
    expect(['admin', 'user']).toContain(row.role);
  });
});
