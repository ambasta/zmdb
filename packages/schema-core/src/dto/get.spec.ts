import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, serial, text, integer } from '../index.ts';
import { getResult, type GetDTO } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});
type S = typeof UserSchema;

describe('GetDTO + Projection (#165)', () => {
  const row = { id: 1, email: 'a@b.com', age: 30 };

  it('getResult with select narrows the row', () => {
    expect(getResult(row, { select: ['id', 'email'] as const })).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('getResult without select ⇒ full row', () => {
    expect(getResult(row)).toEqual(row);
  });

  it('type-level: GetDTO with no options ⇒ Entity', () => {
    expectTypeOf<GetDTO<S>>().toEqualTypeOf<{ id: number; email: string; age: number }>();
  });

  it('type-level: GetDTO with select ⇒ Projection', () => {
    expectTypeOf<GetDTO<S, { select: readonly ['id', 'age'] }>>().toEqualTypeOf<{ id: number; age: number }>();
  });
});
