import { describe, it, expect } from 'vitest';

import { enableRlsDdl, createPolicyDdl, UnsupportedFeatureError } from './index.ts';

/** RLS is Postgres-only, so every other dialect must refuse by name rather than emit something. */
function expectRefused(dialect: string, emit: () => unknown) {
  let thrown: unknown;
  try {
    emit();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(UnsupportedFeatureError);
  const e = thrown as UnsupportedFeatureError;
  expect(e.feature).toBe('row-level security');
  expect(e.dialect).toBe(dialect);
}

describe('RLS DDL (#115)', () => {
  it('enables RLS on a table (pg)', () => {
    expect(enableRlsDdl('documents', 'postgres')).toBe('ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY');
  });

  it('creates a policy (default command ALL)', () => {
    expect(
      createPolicyDdl({ name: 'owner', table: 'documents', using: 'owner_id = current_user_id()' }, 'postgres'),
    ).toBe('CREATE POLICY "owner" ON "documents" FOR ALL USING (owner_id = current_user_id())');
  });

  it('creates a policy for a specific command', () => {
    expect(createPolicyDdl({ name: 'sel', table: 't', using: 'a = 1', command: 'SELECT' }, 'postgres')).toBe(
      'CREATE POLICY "sel" ON "t" FOR SELECT USING (a = 1)',
    );
  });

  it('RLS on non-postgres throws', () => {
    expectRefused('mysql', () => enableRlsDdl('t', 'mysql'));
    expectRefused('sqlite', () => createPolicyDdl({ name: 'p', table: 't', using: 'x' }, 'sqlite'));
  });
});
