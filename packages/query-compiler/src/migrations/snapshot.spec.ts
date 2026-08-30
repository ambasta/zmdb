import { describe, it, expect } from 'vitest';

import type { CoreSchema } from '../index.ts';
import { snapshot } from './index.ts';

// #41: schema snapshot serializer. Tests written BEFORE implementation (TDD).

const UserSchema = {
  table: 'users',
  columns: {
    // Intentionally out of alphabetical order to prove deterministic sorting.
    email: { type: 'text', flags: { nullable: false } },
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

describe('snapshot serializer', () => {
  it('produces a version-1 snapshot with tables sorted by name and columns sorted by name', () => {
    const snap = snapshot([UserSchema]);
    expect(snap.version).toBe(1);
    expect(snap.tables.map(t => t.name)).toEqual(['users']);
    expect(snap.tables[0]?.columns.map(c => c.name)).toEqual(['email', 'id']);
  });

  it('captures type/nullable/primaryKey per column', () => {
    const snap = snapshot([UserSchema]);
    const cols = snap.tables[0]?.columns ?? [];
    expect(cols).toContainEqual({ name: 'id', type: 'serial', nullable: false, primaryKey: true });
    expect(cols).toContainEqual({ name: 'email', type: 'text', nullable: false, primaryKey: false });
  });

  it('is deterministic: serializing twice yields identical JSON', () => {
    expect(JSON.stringify(snapshot([UserSchema]))).toBe(JSON.stringify(snapshot([UserSchema])));
  });
});
