import { describe, it, expect } from 'vitest';

import { diff, emitUp, emitDown, type SchemaSnapshot } from './index.js';

// RED PHASE (#40 spec freeze): diff engine + DDL emitter goldens.

const snap = (tables: SchemaSnapshot['tables']): SchemaSnapshot => ({ version: 1, tables });

const usersV1 = snap([
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false, primaryKey: false },
    ],
  },
]);

const usersV2 = snap([
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false, primaryKey: false },
      { name: 'age', type: 'integer', nullable: false, primaryKey: false },
    ],
  },
]);

describe('diff engine', () => {
  it('identical snapshots → no ops', () => {
    expect(diff(usersV1, usersV1)).toEqual([]);
  });

  it('detects an added column', () => {
    const ops = diff(usersV1, usersV2);
    expect(ops).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
    });
  });
});

describe('DDL emitter (postgres)', () => {
  const addAge = {
    kind: 'add_column' as const,
    table: 'users',
    column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
  };

  it('emits up SQL for add_column', () => {
    expect(emitUp(addAge, 'postgres')).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });

  it('down reverses up for add_column', () => {
    expect(emitDown(addAge, 'postgres')).toBe('ALTER TABLE "users" DROP COLUMN "age"');
  });
});
