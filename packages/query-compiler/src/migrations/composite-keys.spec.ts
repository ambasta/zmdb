import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { diff, emitDown, emitUp, snapshot, type ChangeOp, type SchemaSnapshot, type TableSnapshot } from './index.js';

// Composite primary keys, at the migration boundary. Tests freeze for the epic
// "Composite primary keys and expression indexes" (#407 / spec freeze #408).
//
// Every claim here is quoted from `./SPEC.md` §1.1-§1.3, which is frozen. The tests cover
// the ordered snapshot field, table-level DDL, reversible key-change operation and SQLite's
// explicit refusal.

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];

// ---------------------------------------------------------------------------
// §1.2 Key DDL, per dialect
// ---------------------------------------------------------------------------

/**
 * The spec's own example table, with the two orders that make it the example: the columns are
 * alphabetical because that is the snapshot's determinism rule, and the key is
 * `(user_id, org_id)` because that is the declaration order.
 */
const createMemberships: Extract<ChangeOp, { kind: 'create_table' }> = {
  kind: 'create_table',
  table: 'memberships',
  columns: [
    { name: 'org_id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'role', type: 'text', nullable: false, primaryKey: false },
    { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
  ],
  primaryKey: ['user_id', 'org_id'],
  foreignKeys: [],
};

describe('composite key DDL (frozen: migrations/SPEC.md 1.2)', () => {
  // The whole statement per dialect, not a fragment. The defect is a *second* `PRIMARY KEY`
  // appearing, and `toContain('PRIMARY KEY')` passes either way.
  it('emits one table-level PRIMARY KEY for a two-column key', () => {
    const golden: Readonly<Record<Dialect, string>> = {
      postgres:
        'CREATE TABLE "memberships" ("org_id" INTEGER NOT NULL, "role" TEXT NOT NULL, ' +
        '"user_id" INTEGER NOT NULL, PRIMARY KEY ("user_id", "org_id"))',
      mysql:
        'CREATE TABLE `memberships` (`org_id` INT NOT NULL, `role` TEXT NOT NULL, ' +
        '`user_id` INT NOT NULL, PRIMARY KEY (`user_id`, `org_id`))',
      sqlite:
        'CREATE TABLE "memberships" ("org_id" INTEGER NOT NULL, "role" TEXT NOT NULL, ' +
        '"user_id" INTEGER NOT NULL, PRIMARY KEY ("user_id", "org_id"))',
    };
    // A key column emits `NOT NULL` explicitly in this form, which the inline form suppresses
    // as redundant. It is not redundant here: SQLite permits a NULL in a `PRIMARY KEY` column
    // of a *table* constraint unless the column says `NOT NULL`.
    for (const dialect of DIALECTS) expect(emitUp(createMemberships, dialect), dialect).toBe(golden[dialect]);
  });

  it('executes the composite CREATE TABLE on sqlite', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(emitUp(createMemberships, 'sqlite'));
      expect(
        database.prepare("SELECT name FROM pragma_table_info('memberships') WHERE pk > 0 ORDER BY pk").all(),
      ).toEqual([{ name: 'user_id' }, { name: 'org_id' }]);
    } finally {
      database.close();
    }
  });

  // The no-regression half. A single-column key keeps the inline form because
  // `INTEGER PRIMARY KEY` is SQLite's rowid
  // alias, which is what makes a `serial` auto-increment there, and no existing golden may
  // move. If the table-constraint form above is implemented by moving *every* key to a
  // trailing clause, this is the test that goes red.
  it('keeps the inline PRIMARY KEY for a single-column key', () => {
    const createUsers: Extract<ChangeOp, { kind: 'create_table' }> = {
      kind: 'create_table',
      table: 'users',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', nullable: false, primaryKey: false, length: 255 },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    const golden: Readonly<Record<Dialect, string>> = {
      postgres: 'CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "email" VARCHAR(255) NOT NULL)',
      mysql: 'CREATE TABLE `users` (`id` INT AUTO_INCREMENT PRIMARY KEY, `email` VARCHAR(255) NOT NULL)',
      sqlite: 'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "email" TEXT NOT NULL)',
    };
    for (const dialect of DIALECTS) expect(emitUp(createUsers, dialect), dialect).toBe(golden[dialect]);
  });
});

// ---------------------------------------------------------------------------
// §1.1 The key is on the table, not only on the columns
// ---------------------------------------------------------------------------

describe('the key on the snapshot (frozen: migrations/SPEC.md 1.1)', () => {
  // `snapshot` reads the key from the `SnapshotableSchema` list rather than reconstructing it
  // from per-column flags, which would lose declaration order.
  it('carries the ordered key on the table snapshot, not only on its columns', () => {
    const snap = snapshot([
      {
        table: 'memberships',
        primaryKey: ['user_id', 'org_id'],
        // Declaration order, which is what the key list has to preserve. The *columns* come
        // back sorted by name; the key does not, because sorting it would destroy the one
        // fact it exists to carry.
        columns: {
          user_id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
          org_id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
          role: { type: 'text', flags: { nullable: false } },
        },
      },
    ]);
    const table = snap.tables[0];
    expect(table?.primaryKey).toEqual(['user_id', 'org_id']);
    // And the surrounding determinism rule still applies to the columns.
    expect(table?.columns.map(column => column.name)).toEqual(['org_id', 'role', 'user_id']);
  });
});

// ---------------------------------------------------------------------------
// §1.3 What `diff` emits when a key changes
// ---------------------------------------------------------------------------

/** `(user_id)`: `org_id` is present and not keyed. */
const keyedOnUser: SchemaSnapshot = {
  version: 1,
  extensions: [],
  tables: [
    {
      name: 'memberships',
      columns: [
        { name: 'org_id', type: 'integer', nullable: false, primaryKey: false },
        { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
      ],
      primaryKey: ['user_id'],
      foreignKeys: [],
    },
  ],
};

/** `(user_id, org_id)`: the same two columns, both keyed. */
const keyedOnBothTable: TableSnapshot = {
  name: 'memberships',
  columns: [
    { name: 'org_id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
  ],
  primaryKey: ['user_id', 'org_id'],
  foreignKeys: [],
};

const keyedOnBoth: TableSnapshot[] = [keyedOnBothTable];

/** `(org_id, user_id)`: the same *set*, reordered. Moves no per-column flag whatsoever. */
const keyedOnBothReversed: TableSnapshot[] = [
  {
    ...keyedOnBothTable,
    primaryKey: ['org_id', 'user_id'],
  },
];

const asSnapshot = (tables: readonly TableSnapshot[]): SchemaSnapshot => ({
  version: 1,
  extensions: [],
  tables,
});

const alterKey: Extract<ChangeOp, { kind: 'alter_primary_key' }> = {
  kind: 'alter_primary_key',
  table: 'memberships',
  from: ['user_id'],
  to: ['user_id', 'org_id'],
};

describe('diffing a key change (frozen: migrations/SPEC.md 1.3)', () => {
  // The issue's sketch asked for "a drop and an add". The frozen spec is one op and one
  // statement per direction, "because a table without a primary key is a state no migration
  // should be interruptible in", so this asserts one op.
  it('diffs a key that gained a column into one alter_primary_key op', () => {
    expect(diff(keyedOnUser, asSnapshot(keyedOnBoth))).toEqual([alterKey]);
  });

  // The case a flag-only snapshot cannot see even in principle. `(a, b)` and `(b, a)` are the
  // same set, build different indexes, and move no flag — so this is the assertion that
  // argues for the list rather than for reading the flags more carefully.
  it('diffs a reordered key, which moves no per-column flag', () => {
    expect(diff(asSnapshot(keyedOnBoth), asSnapshot(keyedOnBothReversed))).toEqual([
      { kind: 'alter_primary_key', table: 'memberships', from: ['user_id', 'org_id'], to: ['org_id', 'user_id'] },
    ]);
  });

  it('round-trips a composite key without producing a second migration', () => {
    const taken = snapshot([
      {
        table: 'memberships',
        primaryKey: ['user_id', 'org_id'],
        columns: {
          user_id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
          org_id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
        },
      },
    ]);
    expect(diff(taken, taken)).toEqual([]);
    expect(diff({ version: 1, tables: [], extensions: [] }, taken)).toEqual([
      {
        kind: 'create_table',
        table: 'memberships',
        columns: [
          { name: 'org_id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
        ],
        primaryKey: ['user_id', 'org_id'],
        foreignKeys: [],
      },
    ]);
  });

  it('emits one statement per direction for a key change on postgres and mysql', () => {
    expect(emitUp(alterKey, 'postgres')).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id", "org_id")',
    );
    expect(emitDown(alterKey, 'postgres')).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id")',
    );
    expect(emitUp(alterKey, 'mysql')).toBe(
      'ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`, `org_id`)',
    );
    expect(emitDown(alterKey, 'mysql')).toBe('ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`)');
  });

  // SQLite has no `ALTER TABLE` form that touches a primary key. The emitter refuses rather
  // than skipping the op, because a skipped op is a schema that diverges from its snapshot
  // with nothing reporting it.
  // The regex is deliberately ASCII-only. The frozen message contains a U+2192 arrow and an
  // em dash; matching the table name and the reason around them keeps the assertion readable
  // and keeps it from failing on a whitespace or punctuation edit to the message.
  it('refuses to alter a primary key on sqlite, naming the table', () => {
    expect(() => emitUp(alterKey, 'sqlite')).toThrow(UnsupportedFeatureError);
    expect(() => emitUp(alterKey, 'sqlite')).toThrow(/sqlite cannot alter the primary key of "memberships"/);
    expect(() => emitUp(alterKey, 'sqlite')).toThrow(/SQLite has no\s+ALTER TABLE form for a key/);
    expect(() => emitDown(alterKey, 'sqlite')).toThrow(/sqlite cannot alter the primary key of "memberships"/);
  });
});
