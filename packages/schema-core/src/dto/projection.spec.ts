import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, serial, text, integer } from '../index.ts';
import type { Entity } from '../index.ts';
import { project, type Projection } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});
type S = typeof UserSchema;

describe('typed select()/projection narrowing (#185)', () => {
  const row = { id: 1, email: 'a@b.com', age: 30 };

  it('project picks only the selected columns, in order', () => {
    expect(project(row, ['email', 'id'] as const)).toEqual({ email: 'a@b.com', id: 1 });
  });

  it('project undefined ⇒ passthrough (same row)', () => {
    expect(project(row, undefined)).toEqual(row);
  });

  it('project does not mutate the input', () => {
    const copy = { ...row };
    project(row, ['id'] as const);
    expect(row).toEqual(copy);
  });

  it('type-level: Projection narrows Entity to the picked keys', () => {
    expectTypeOf<Projection<S, 'id' | 'email'>>().toEqualTypeOf<{ id: number; email: string }>();
    // full entity keys for reference
    expectTypeOf<keyof Entity<S>>().toEqualTypeOf<'id' | 'email' | 'age'>();
  });
});
