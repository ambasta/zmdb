import { describe, it, expect } from 'vitest';

import { createSchemaQueryCompiler } from './index.js';
import type { Table, Sql, Serial, PrimaryKey } from './tags/index.js';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
  createdAt: Date & Sql<'timestamp'>;
  meta: { theme: string } & Sql<'json'>;
}

describe('Type-Bounded Schema Query Compiler in @zmdb/schema-core', () => {
  const qc = createSchemaQueryCompiler<User>('postgres');

  it('compiles valid schema-bounded queries using TsType derivation', () => {
    const selectQ = qc
      .selectFrom('users')
      .select(['id', 'email', 'createdAt'])
      .where('createdAt', '=', new Date('2026-01-01'))
      .andWhere('role', '=', 'admin')
      .compile();

    expect(selectQ.text).toBe('SELECT "id", "email", "createdAt" FROM "users" WHERE "createdAt" = $1 AND "role" = $2');

    const insertQ = qc
      .insertInto('users')
      .values({ email: 'new@example.com', role: 'user', createdAt: new Date(), meta: { theme: 'dark' } })
      .returning(['id', 'email'])
      .compile();

    expect(insertQ.text).toBe(
      'INSERT INTO "users" ("email", "role", "createdAt", "meta") VALUES ($1, $2, $3, $4) RETURNING "id", "email"',
    );

    const updateQ = qc.updateTable('users').set({ role: 'admin' }).where('id', '=', 1).returning(['*']).compile();

    expect(updateQ.text).toBe('UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING *');
  });

  it('verifies compile-time type-checking against schema TsType', () => {
    // @ts-expect-error - timestamp expects Date, string is rejected
    qc.selectFrom('users').where('createdAt', '=', '2026-01-01');

    // @ts-expect-error - role expects 'admin' | 'user', invalid string is rejected
    qc.selectFrom('users').where('role', '=', 'superadmin');

    // @ts-expect-error - invalid column name in select
    qc.selectFrom('users').select(['invalid_column']);

    // @ts-expect-error - invalid column name in insert
    qc.insertInto('users').values({ invalid_col: 'test' });

    // @ts-expect-error - value type mismatch in update for json payload column: meta expects { theme: string }, got number
    qc.updateTable('users').set({ meta: 123 });
  });
});
