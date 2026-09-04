import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { diff, emitDown, emitUp, snapshot, type ChangeOp, type SchemaSnapshot, type TableSnapshot } from './index.js';

// Composite primary keys, at the migration boundary. Tests freeze for the epic
// "Composite primary keys and expression indexes" (#407 / spec freeze #408).
//
// Every claim here is quoted from `./SPEC.md` §1.1-§1.3, which is frozen. None of it is
// implemented, so most of this file is `it.fails`: the body calls the real exported function
// and asserts the frozen answer, and the `actual today` comment above each one is the string
// that function produces right now, captured by running it. That comment is the part that
// makes an `it.fails` worth having — a red test with an invented wrong value can go green for
// the wrong reason, and nobody would be able to tell.
//
// `it.fails` rather than `.skip` (a skipped test is invisible in the summary line) and rather
// than a `declare`d stub (a missing symbol fails with a ReferenceError, which is not the
// reason the spec names). Vitest reports these in their own bucket — `N expected fail` — so
// the suite total grows and stays green, and an `it.fails` that starts passing fails the run
// with "Expect test to fail". The conversion to `it` therefore cannot be forgotten.

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §1.1 puts `primaryKey: readonly string[]` on `TableSnapshot` and §1.3 adds an
// `alter_primary_key` op and a key on the `create_table` payload. None of the three exists in
// `./index.ts` yet, and a test that cannot be typechecked is not a test. So the *widening* is
// declared here — only the widening, intersected with the real exported type so the two
// cannot drift — and handed to the real function through one assertion per call site. All of
// this deletes itself in the slice that widens `ChangeOp` and `TableSnapshot` for real.

type FrozenTableSnapshot = TableSnapshot & { readonly primaryKey: readonly string[] };

type FrozenCreateTable = Extract<ChangeOp, { kind: 'create_table' }> & {
  readonly primaryKey: readonly string[];
};

/** §1.3: one op, because none of the five existing ops can carry a key change. */
interface AlterPrimaryKey {
  readonly kind: 'alter_primary_key';
  readonly table: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

type FrozenChangeOp = ChangeOp | FrozenCreateTable | AlterPrimaryKey;

/**
 * The real emitter, over an op the real `ChangeOp` union does not admit yet.
 *
 * boundary: the op is one of the two shapes §1.3 freezes, and `emitUp`'s switch has no
 * `default` — an unknown `kind` falls out of it and the function returns `undefined` despite
 * its `string` return type. That is what these assertions record, and it is why they fail on
 * a comparison rather than on a throw.
 */
function up(op: FrozenChangeOp, dialect: Dialect): string {
  return emitUp(op as ChangeOp, dialect);
}

/** The same, for the down direction. See `up`. */
function down(op: FrozenChangeOp, dialect: Dialect): string {
  return emitDown(op as ChangeOp, dialect);
}

// ---------------------------------------------------------------------------
// §1.2 Key DDL, per dialect
// ---------------------------------------------------------------------------

/**
 * The spec's own example table, with the two orders that make it the example: the columns are
 * alphabetical because that is the snapshot's determinism rule, and the key is
 * `(user_id, org_id)` because that is the declaration order.
 */
const createMemberships: FrozenCreateTable = {
  kind: 'create_table',
  table: 'memberships',
  columns: [
    { name: 'org_id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'role', type: 'text', nullable: false, primaryKey: false },
    { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
  ],
  primaryKey: ['user_id', 'org_id'],
};

describe('composite key DDL (frozen: migrations/SPEC.md 1.2)', () => {
  // The whole statement per dialect, not a fragment. The defect is a *second* `PRIMARY KEY`
  // appearing, and `toContain('PRIMARY KEY')` passes either way.
  //
  // actual today, all three dialects (the key on the payload is ignored and `columnDdl` writes
  // ` PRIMARY KEY` once per flagged column):
  //   postgres  CREATE TABLE "memberships" ("org_id" INTEGER PRIMARY KEY, "role" TEXT NOT NULL, "user_id" INTEGER PRIMARY KEY)
  //   mysql     CREATE TABLE `memberships` (`org_id` INT PRIMARY KEY, `role` TEXT NOT NULL, `user_id` INT PRIMARY KEY)
  //   sqlite    CREATE TABLE "memberships" ("org_id" INTEGER PRIMARY KEY, "role" TEXT NOT NULL, "user_id" INTEGER PRIMARY KEY)
  // Postgres rejects that with "multiple primary keys for table are not allowed"; the other
  // two have their own version of the same error. Nobody can migrate this table today.
  it.fails('emits one table-level PRIMARY KEY for a two-column key', () => {
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
    for (const dialect of DIALECTS) expect(up(createMemberships, dialect), dialect).toBe(golden[dialect]);
  });

  // The no-regression half, and it passes today — which is the point of asserting it. A
  // single-column key keeps the inline form because `INTEGER PRIMARY KEY` is SQLite's rowid
  // alias, which is what makes a `serial` auto-increment there, and no existing golden may
  // move. If the table-constraint form above is implemented by moving *every* key to a
  // trailing clause, this is the test that goes red.
  it('keeps the inline PRIMARY KEY for a single-column key', () => {
    const createUsers: FrozenCreateTable = {
      kind: 'create_table',
      table: 'users',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', nullable: false, primaryKey: false, length: 255 },
      ],
      primaryKey: ['id'],
    };
    const golden: Readonly<Record<Dialect, string>> = {
      postgres: 'CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "email" VARCHAR(255) NOT NULL)',
      mysql: 'CREATE TABLE `users` (`id` INT AUTO_INCREMENT PRIMARY KEY, `email` VARCHAR(255) NOT NULL)',
      sqlite: 'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "email" TEXT NOT NULL)',
    };
    for (const dialect of DIALECTS) expect(up(createUsers, dialect), dialect).toBe(golden[dialect]);
  });
});

// ---------------------------------------------------------------------------
// §1.1 The key is on the table, not only on the columns
// ---------------------------------------------------------------------------

describe('the key on the snapshot (frozen: migrations/SPEC.md 1.1)', () => {
  // `snapshot` reads a `SnapshotableSchema`, whose `columns` is a record of per-column flags
  // and which has nowhere to say what the key *is*. A `CoreSchema` — the only thing that is
  // ever passed here — already carries `primaryKey: readonly string[]`, so the input type has
  // to name it too. §1.1 widens `TableSnapshot` and does not mention the input; without that
  // second field the only way to produce the list is to filter the columns on the flag, which
  // `schema-core/src/ir/SPEC.md` §4.1 forbids in as many words.
  //
  // actual today: {"version":1,"tables":[{"name":"memberships","columns":[
  //   {"name":"org_id","type":"integer","nullable":false,"primaryKey":true},
  //   {"name":"role","type":"text","nullable":false,"primaryKey":false},
  //   {"name":"user_id","type":"integer","nullable":false,"primaryKey":true}]}]}
  // — no `primaryKey` on the table at all, so the expression below is `undefined`.
  it.fails('carries the ordered key on the table snapshot, not only on its columns', () => {
    const snap = snapshot([
      {
        table: 'memberships',
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
    const table = snap.tables[0] as FrozenTableSnapshot | undefined;
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
    },
  ],
};

/** `(user_id, org_id)`: the same two columns, both keyed. */
const keyedOnBoth: FrozenTableSnapshot[] = [
  {
    name: 'memberships',
    columns: [
      { name: 'org_id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'integer', nullable: false, primaryKey: true },
    ],
    primaryKey: ['user_id', 'org_id'],
  },
];

/** `(org_id, user_id)`: the same *set*, reordered. Moves no per-column flag whatsoever. */
const keyedOnBothReversed: FrozenTableSnapshot[] = [
  {
    ...(keyedOnBoth[0] as FrozenTableSnapshot),
    primaryKey: ['org_id', 'user_id'],
  },
];

/**
 * boundary: a snapshot carrying the frozen `primaryKey` field, handed to the real `diff`. The
 * extra field is inert to today's implementation, which is the point — the ops below are what
 * `diff` produces when it can see the key, and the recorded actuals are what it produces when
 * it cannot.
 */
const asSnapshot = (tables: readonly FrozenTableSnapshot[]): SchemaSnapshot => ({
  version: 1,
  extensions: [],
  tables: tables as readonly TableSnapshot[],
});

const alterKey: AlterPrimaryKey = {
  kind: 'alter_primary_key',
  table: 'memberships',
  from: ['user_id'],
  to: ['user_id', 'org_id'],
};

describe('diffing a key change (frozen: migrations/SPEC.md 1.3)', () => {
  // The issue's sketch asked for "a drop and an add". The frozen spec is one op and one
  // statement per direction, "because a table without a primary key is a state no migration
  // should be interruptible in", so this asserts one op.
  //
  // actual today: [] — and not because the flag is ambiguous, which is what §1.1's prose
  // implies. `diff` never looks at `primaryKey` at all, on the table or on a column: it
  // compares column names and column *types*, so a key change of any kind produces no op
  // whatsoever and the migration silently does nothing.
  it.fails('diffs a key that gained a column into one alter_primary_key op', () => {
    expect(diff(keyedOnUser, asSnapshot(keyedOnBoth))).toEqual([alterKey]);
  });

  // The case a flag-only snapshot cannot see even in principle. `(a, b)` and `(b, a)` are the
  // same set, build different indexes, and move no flag — so this is the assertion that
  // argues for the list rather than for reading the flags more carefully.
  //
  // actual today: []
  it.fails('diffs a reordered key, which moves no per-column flag', () => {
    expect(diff(asSnapshot(keyedOnBoth), asSnapshot(keyedOnBothReversed))).toEqual([
      { kind: 'alter_primary_key', table: 'memberships', from: ['user_id', 'org_id'], to: ['org_id', 'user_id'] },
    ]);
  });

  // actual today, both directions and both dialects: undefined. `emitUp`/`emitDown` switch on
  // `op.kind` with no `default`, so an op the union does not know falls straight through and
  // the function returns `undefined` in spite of its `string` return type.
  it.fails('emits one statement per direction for a key change on postgres and mysql', () => {
    expect(up(alterKey, 'postgres')).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id", "org_id")',
    );
    expect(down(alterKey, 'postgres')).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id")',
    );
    expect(up(alterKey, 'mysql')).toBe(
      'ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`, `org_id`)',
    );
    expect(down(alterKey, 'mysql')).toBe('ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`)');
  });

  // SQLite has no `ALTER TABLE` form that touches a primary key. The emitter refuses rather
  // than skipping the op, because a skipped op is a schema that diverges from its snapshot
  // with nothing reporting it.
  //
  // actual today: emitUp(alterKey, 'sqlite') returns undefined and throws nothing at all —
  // which is the silently-skipped op in its purest form.
  //
  // The regex is deliberately ASCII-only. The frozen message contains a U+2192 arrow and an
  // em dash; matching the table name and the reason around them keeps the assertion readable
  // and keeps it from failing on a whitespace or punctuation edit to the message.
  //
  // The class and the message are both asserted, and today they cannot both be satisfied:
  // `UnsupportedFeatureError(feature, dialect)` builds its own message, `<feature> is not
  // supported on dialect "<dialect>"`, and the frozen text is not of that shape. The
  // implementation slice has to widen the constructor or the spec has to give up the wording.
  // Asserting both is what makes that a decision somebody takes rather than one they discover.
  it.fails('refuses to alter a primary key on sqlite, naming the table', () => {
    expect(() => up(alterKey, 'sqlite')).toThrow(UnsupportedFeatureError);
    expect(() => up(alterKey, 'sqlite')).toThrow(/sqlite cannot alter the primary key of "memberships"/);
    expect(() => up(alterKey, 'sqlite')).toThrow(/SQLite has no\s+ALTER TABLE form for a key/);
    expect(() => down(alterKey, 'sqlite')).toThrow(/sqlite cannot alter the primary key of "memberships"/);
  });
});
