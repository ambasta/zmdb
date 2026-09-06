import { describe, it, expect } from 'vitest';

import { diff, emitDown, emitUp, snapshot, type SchemaSnapshot } from './index.js';

// #41: schema snapshot serializer.

// A stand-in for a `CoreSchema`: this package sits below `@zmdb/schema-core` in
// the DAG, so the fixture is a plain object with the same shape (including the
// fields `snapshot` ignores). It needs no cast — `snapshot` takes
// `SnapshotableSchema`, the structural slice it actually reads.
const UserSchema = {
  table: 'users',
  columns: {
    // Intentionally out of alphabetical order to prove deterministic sorting.
    email: { type: 'text', flags: { nullable: false } },
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  },
  primaryKey: ['id'],
  references: [],
};

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
    expect(snap.tables[0]?.primaryKey).toEqual(['id']);
    expect(cols).toContainEqual({ name: 'id', type: 'serial', nullable: false, primaryKey: true });
    expect(cols).toContainEqual({ name: 'email', type: 'text', nullable: false, primaryKey: false });
  });

  it('produces byte-identical snapshots, diffs and up/down SQL through @zmdb/migrations', () => {
    const empty: SchemaSnapshot = { version: 1, tables: [], extensions: [] };
    const firstSnapshot = snapshot([UserSchema]);
    const secondSnapshot = snapshot([UserSchema]);
    const firstDiff = diff(empty, firstSnapshot, { dialect: 'postgres' });
    const secondDiff = diff(empty, secondSnapshot, { dialect: 'postgres' });

    const snapshotBytes =
      '{"version":1,"tables":[{"name":"users","columns":[{"name":"email","type":"text","nullable":false,"primaryKey":false},{"name":"id","type":"serial","nullable":false,"primaryKey":true}],"primaryKey":["id"],"foreignKeys":[]}],"extensions":[]}';
    const diffBytes =
      '[{"kind":"create_table","table":"users","columns":[{"name":"email","type":"text","nullable":false,"primaryKey":false},{"name":"id","type":"serial","nullable":false,"primaryKey":true}],"primaryKey":["id"],"foreignKeys":[]}]';

    expect(JSON.stringify(firstSnapshot)).toBe(snapshotBytes);
    expect(JSON.stringify(secondSnapshot)).toBe(snapshotBytes);
    expect(JSON.stringify(firstDiff)).toBe(diffBytes);
    expect(JSON.stringify(secondDiff)).toBe(diffBytes);
    expect(firstDiff.map(operation => emitUp(operation, 'postgres'))).toEqual([
      'CREATE TABLE "users" ("email" TEXT NOT NULL, "id" SERIAL PRIMARY KEY)',
    ]);
    expect(firstDiff.toReversed().map(operation => emitDown(operation, 'postgres'))).toEqual(['DROP TABLE "users"']);
    expect(firstDiff.map(operation => emitUp(operation, 'postgres'))).toEqual(
      secondDiff.map(operation => emitUp(operation, 'postgres')),
    );
    expect(firstDiff.toReversed().map(operation => emitDown(operation, 'postgres'))).toEqual(
      secondDiff.toReversed().map(operation => emitDown(operation, 'postgres')),
    );
  });
});
