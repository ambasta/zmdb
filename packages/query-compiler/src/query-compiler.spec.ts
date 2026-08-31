import { describe, it, expect } from 'vitest';

import { createQueryCompiler } from './index.ts';

// RED PHASE (#16 spec freeze): golden SQL fixtures from SPEC.md.

describe('postgres SELECT compilation', () => {
  it('compiles where + orderBy + limit', () => {
    const qb = createQueryCompiler('postgres');
    const q = qb.selectFrom('users').where('email', '=', 'a@b.com').orderBy('createdAt', 'desc').limit(10).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('compiles andWhere with sequential placeholders', () => {
    const q = createQueryCompiler('postgres')
      .selectFrom('users')
      .where('role', '=', 'admin')
      .andWhere('active', '=', true)
      .compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2');
    expect(q.parameters).toEqual(['admin', true]);
  });

  it('compile() is pure (twice → equal)', () => {
    const b = createQueryCompiler('postgres').selectFrom('users').where('id', '=', 1);
    expect(b.compile()).toEqual(b.compile());
  });
});

describe('postgres write compilation', () => {
  it('INSERT ... RETURNING', () => {
    const q = createQueryCompiler('postgres')
      .insertInto('users')
      .values({ email: 'a@b.com', role: 'user' })
      .returning(['id'])
      .compile();
    expect(q.text).toBe('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"');
    expect(q.parameters).toEqual(['a@b.com', 'user']);
  });

  it('UPDATE ... SET ... WHERE', () => {
    const q = createQueryCompiler('postgres').updateTable('users').set({ role: 'admin' }).where('id', '=', 1).compile();
    expect(q.text).toBe('UPDATE "users" SET "role" = $1 WHERE "id" = $2');
    expect(q.parameters).toEqual(['admin', 1]);
  });

  it('DELETE ... WHERE', () => {
    const q = createQueryCompiler('postgres').deleteFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('DELETE FROM "users" WHERE "id" = $1');
    expect(q.parameters).toEqual([1]);
  });
});

describe('dialect placeholder + quoting', () => {
  it('mysql uses ? and backticks', () => {
    const q = createQueryCompiler('mysql')
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .compile();
    expect(q.text).toBe('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('sqlite uses ? and double quotes', () => {
    const q = createQueryCompiler('sqlite').selectFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('SELECT * FROM "users" WHERE "id" = ?');
    expect(q.parameters).toEqual([1]);
  });
});
