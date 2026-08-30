import { describe, it, expect } from 'vitest';

import { createQueryCompiler } from './index.ts';

// #19: dialect coverage across all statement kinds (Postgres/MySQL/SQLite).

describe('dialect coverage — writes', () => {
  it('postgres INSERT uses $n placeholders and double quotes', () => {
    const q = createQueryCompiler('postgres').insertInto('users').values({ email: 'a@b.com' }).compile();
    expect(q.text).toBe('INSERT INTO "users" ("email") VALUES ($1)');
  });

  it('mysql INSERT uses ? placeholders and backticks', () => {
    const q = createQueryCompiler('mysql').insertInto('users').values({ email: 'a@b.com' }).compile();
    expect(q.text).toBe('INSERT INTO `users` (`email`) VALUES (?)');
  });

  it('sqlite UPDATE uses ? placeholders and double quotes', () => {
    const q = createQueryCompiler('sqlite')
      .updateTable('users')
      .set({ email: 'a@b.com' })
      .where('id', '=', 1)
      .compile();
    expect(q.text).toBe('UPDATE "users" SET "email" = ? WHERE "id" = ?');
  });

  it('mysql DELETE uses ? placeholders and backticks', () => {
    const q = createQueryCompiler('mysql').deleteFrom('users').where('id', '=', 1).compile();
    expect(q.text).toBe('DELETE FROM `users` WHERE `id` = ?');
  });
});
