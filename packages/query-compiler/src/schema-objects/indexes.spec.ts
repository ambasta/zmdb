import { describe, it, expect } from 'vitest';
import { createIndexDdl, checkConstraintDdl } from './index.ts';

describe('indexes & constraints DDL (#100)', () => {
  it('creates a non-unique index', () => {
    expect(createIndexDdl({ name: 'idx_users_email', table: 'users', columns: ['email'] }, 'postgres')).toBe(
      'CREATE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('creates a unique, multi-column, partial index', () => {
    expect(
      createIndexDdl({ name: 'u_ab', table: 't', columns: ['a', 'b'], unique: true, where: 'a IS NOT NULL' }, 'postgres'),
    ).toBe('CREATE UNIQUE INDEX "u_ab" ON "t" ("a", "b") WHERE a IS NOT NULL');
  });

  it('check constraint', () => {
    expect(checkConstraintDdl('orders', 'chk_total', 'total >= 0', 'postgres')).toBe(
      'ALTER TABLE "orders" ADD CONSTRAINT "chk_total" CHECK (total >= 0)',
    );
  });
});
