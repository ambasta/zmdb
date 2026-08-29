import { describe, it, expect } from 'vitest';
import { compilePopulate, manyToOne, oneToMany } from './index.ts';

// #33: JOIN / batched-select compilation for populate. Tests first (TDD).

describe('compilePopulate — to-one (JOIN)', () => {
  it('compiles a many-to-one relation as an INNER JOIN', () => {
    const rel = manyToOne('users', 'userId');
    const q = compilePopulate('orders', 'user', rel, 'postgres');
    expect(q.kind).toBe('join');
    expect(q.sql).toBe(
      'SELECT * FROM "orders" INNER JOIN "users" ON "orders"."userId" = "users"."id"',
    );
  });
});

describe('compilePopulate — to-many (batched select)', () => {
  it('compiles a one-to-many relation as a batched IN() select', () => {
    const rel = oneToMany('orders', 'userId');
    const q = compilePopulate('users', 'orders', rel, 'postgres', [1, 2, 3]);
    expect(q.kind).toBe('batched');
    expect(q.sql).toBe('SELECT * FROM "orders" WHERE "userId" IN ($1, $2, $3)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });
});
