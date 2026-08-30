import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, serial, text, integer, jsonEnum } from '../index.ts';
import type { Entity } from '../index.ts';
import { compileWhere, type WhereDTO, type FieldOps } from './index.ts';

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
  const mk = (): any => ({
    where: (c: string, o: string, v: unknown) => (calls.push(['and', c, o, v]), mk()),
    orWhere: (c: string, o: string, v: unknown) => (calls.push(['or', c, o, v]), mk()),
    calls,
  });
  const b = mk();
  return { b, calls };
}

describe('WhereDTO + operator set (#179)', () => {
  it('bare value ⇒ eq', () => {
    const { b, calls } = recorder();
    compileWhere(b, { role: 'admin' } as WhereDTO<S>);
    expect(calls).toEqual([['and', 'role', '=', 'admin']]);
  });

  it('comparison + membership operators map to SQL', () => {
    const { b, calls } = recorder();
    compileWhere(b, { age: { gte: 18, lt: 65 }, id: { in: [1, 2, 3] } } as WhereDTO<S>);
    expect(calls).toEqual([
      ['and', 'age', '>=', 18],
      ['and', 'age', '<', 65],
      ['and', 'id', 'in', [1, 2, 3]],
    ]);
  });

  it('nin/like/ilike', () => {
    const { b, calls } = recorder();
    compileWhere(b, { role: { nin: ['admin'] }, email: { like: '%@x.com', ilike: '%@Y.com' } } as WhereDTO<S>);
    expect(calls).toEqual([
      ['and', 'role', 'not in', ['admin']],
      ['and', 'email', 'like', '%@x.com'],
      ['and', 'email', 'ilike', '%@Y.com'],
    ]);
  });

  it('isNull / notNull', () => {
    const { b, calls } = recorder();
    compileWhere(b, { email: { isNull: true }, role: { notNull: true } } as WhereDTO<S>);
    expect(calls).toEqual([
      ['and', 'email', 'is null', null],
      ['and', 'role', 'is not null', null],
    ]);
  });

  it('or group ORs its members', () => {
    const { b, calls } = recorder();
    compileWhere(b, { or: [{ role: 'admin' }, { age: { gt: 90 } }] } as WhereDTO<S>);
    expect(calls).toEqual([
      ['or', 'role', '=', 'admin'],
      ['or', 'age', '>', 90],
    ]);
  });

  it('empty where adds nothing', () => {
    const { b, calls } = recorder();
    compileWhere(b, {} as WhereDTO<S>);
    expect(calls).toEqual([]);
  });

  it('type-level: fields are value-typed; like only on strings', () => {
    expectTypeOf<WhereDTO<S>['age']>().toEqualTypeOf<number | FieldOps<number> | undefined>();
    // like/ilike present on string field ops, never on numeric
    expectTypeOf<FieldOps<string>['like']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FieldOps<number>['like']>().toEqualTypeOf<never | undefined>();
    // eq value is the entity field type
    expectTypeOf<FieldOps<Entity<S>['role']>['eq']>().toEqualTypeOf<'admin' | 'user' | undefined>();
  });
});
