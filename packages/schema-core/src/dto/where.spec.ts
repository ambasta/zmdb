import { createQueryCompiler } from '@zmdb/query-compiler';
import { describe, it, expect } from 'vitest';

import { defineSchema, serial, text, integer, jsonEnum } from '../index.ts';
import { compileWhere, type WhereDTO } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});
type S = typeof UserSchema;

// Fake builder that records the where/orWhere calls (compiler-agnostic).
function recorder() {
  const calls: [string, string, string, unknown][] = [];
  interface B {
    where(c: string, o: string, v: unknown): B;
    orWhere(c: string, o: string, v: unknown): B;
    whereExists?(sub: unknown): B;
    orWhereExists?(sub: unknown): B;
    whereNotExists?(sub: unknown): B;
    orWhereNotExists?(sub: unknown): B;
    calls: typeof calls;
  }
  const mk = (): B => ({
    where: (c: string, o: string, v: unknown) => (calls.push(['and', c, o, v]), mk()),
    orWhere: (c: string, o: string, v: unknown) => (calls.push(['or', c, o, v]), mk()),
    whereExists: (sub: unknown) => (calls.push(['and', '', 'EXISTS', sub]), mk()),
    orWhereExists: (sub: unknown) => (calls.push(['or', '', 'EXISTS', sub]), mk()),
    whereNotExists: (sub: unknown) => (calls.push(['and', '', 'NOT EXISTS', sub]), mk()),
    orWhereNotExists: (sub: unknown) => (calls.push(['or', '', 'NOT EXISTS', sub]), mk()),
    calls,
  });
  const b = mk();
  return { b, calls };
}

describe('WhereDTO + operator set (#179)', () => {
  it('bare value ⇒ eq', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = { role: 'admin' };
    compileWhere(b, where);
    expect(calls).toEqual([['and', 'role', '=', 'admin']]);
  });

  it('comparison + membership operators map to SQL', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = { age: { gte: 18, lt: 65 }, id: { in: [1, 2, 3] } };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'age', '>=', 18],
      ['and', 'age', '<', 65],
      ['and', 'id', 'in', [1, 2, 3]],
    ]);
  });

  it('nin/like/ilike', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = { role: { nin: ['admin'] }, email: { like: '%@x.com', ilike: '%@Y.com' } };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'role', 'not in', ['admin']],
      ['and', 'email', 'like', '%@x.com'],
      ['and', 'email', 'ilike', '%@Y.com'],
    ]);
  });

  it('isNull / notNull', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = { email: { isNull: true }, role: { notNull: true } };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'email', 'is null', null],
      ['and', 'role', 'is not null', null],
    ]);
  });

  it('or group ORs its members', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = { or: [{ role: 'admin' }, { age: { gt: 90 } }] };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['or', 'role', '=', 'admin'],
      ['or', 'age', '>', 90],
    ]);
  });

  it('empty where adds nothing', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<S> = {};
    compileWhere(b, where);
    expect(calls).toEqual([]);
  });

  it('subquery comparison operators in FieldOps', () => {
    const qb = createQueryCompiler('postgres');
    const sub = qb.selectFrom('orders').select(['user_id']).where('total', '>', 100);
    const builder = compileWhere(qb.selectFrom('users'), {
      id: { in: sub },
      age: { gt: { table: 'users_stats', select: ['avg_age'] } },
    } as WhereDTO<S>);

    const compiled = builder.compile();
    expect(compiled.text).toBe(
      'SELECT * FROM "users" WHERE "id" IN (SELECT "user_id" FROM "orders" WHERE "total" > $1) AND "age" > (SELECT "avg_age" FROM "users_stats")',
    );
    expect(compiled.parameters).toEqual([100]);
  });

  it('EXISTS operator containing nested filter definitions and subqueries', () => {
    const qb = createQueryCompiler('postgres');
    const builder = compileWhere(qb.selectFrom('users'), {
      role: 'admin',
      exists: {
        table: 'orders',
        where: {
          total: { gte: 500 },
        },
      },
    } as WhereDTO<S>);

    const compiled = builder.compile();
    expect(compiled.text).toBe(
      'SELECT * FROM "users" WHERE "role" = $1 AND EXISTS (SELECT * FROM "orders" WHERE "total" >= $2)',
    );
    expect(compiled.parameters).toEqual(['admin', 500]);
  });
});
