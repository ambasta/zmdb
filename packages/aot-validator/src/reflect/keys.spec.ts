import type { PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { schemasFrom } from '../testing/index.js';
import type { ReflectDiagnostic } from './index.js';

// Deriving a key from a declaration. Tests freeze for the epic "Composite primary keys and
// expression indexes" (#407 / spec freeze #408); the frozen text is
// `@zmdb/schema-core`'s `src/ir/SPEC.md` §4.1.
//
// §4.1 puts two refusals and one ordering rule on the reflector, because this is the only place
// that sees the declaration: after reflection, `(orgId, userId)` and `(userId, orgId)` are two
// arrays and nothing can tell which the author wrote. The interfaces below are declared in this
// file and reflected out of it, which is what `schemasFrom` is for — a fixture two directories
// away is a fixture nobody reads.
//
// `it.fails` for the frozen claims, with the current output recorded above each one. See
// `@zmdb/query-compiler`'s `src/migrations/composite-keys.spec.ts` for why `it.fails` rather than
// `.skip` or a stub.

/**
 * A two-column key whose declaration order is the reverse of alphabetical.
 *
 * That is the whole design of this fixture: `['tenantId', 'userId']` is what a reflector that
 * sorted, or that read the checker's own member order, would produce, and it is not what the
 * interface says.
 */
export interface Membership extends Table<'memberships'> {
  userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;
  tenantId: string & Sql<'text'> & PrimaryKey;
  role: string & Sql<'text'>;
}

/** A `Serial` column inside a two-column key, which §4.1 refuses. */
export interface SerialComposite extends Table<'serial_composite'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: string & Sql<'text'> & PrimaryKey;
}

/** The same `Serial` column as the whole key, which is the ordinary case and stays legal. */
export interface SerialSingle extends Table<'serial_single'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: string & Sql<'text'>;
}

/** A join table with no `PrimaryKey` tag, which §4.1 calls legal IR. */
export interface Keyless extends Table<'keyless'> {
  userId: number & Sql<'integer'> & References<'users.id'>;
  groupId: number & Sql<'integer'> & References<'groups.id'>;
}

/**
 * One reflection of this module, with the diagnostics collected rather than thrown.
 *
 * `schemasFrom` throws on a diagnostic by default, and half the claims here are *about* the
 * diagnostics, so they are captured instead. One call for the whole file because a session costs
 * about 80ms to open and this is module scope; the four names are resolved out of the one session.
 */
const diagnostics: ReflectDiagnostic[] = [];
const {
  Keyless: keyless,
  Membership: memberships,
  SerialSingle: serialSingle,
} = schemasFrom(import.meta.url, ['Keyless', 'Membership', 'SerialComposite', 'SerialSingle'], {
  onDiagnostics: found => diagnostics.push(...found),
});
// `SerialComposite` is named in the call and not destructured on purpose: reflecting it is what
// raises (or, today, fails to raise) the diagnostic the test below reads, and its schema value is
// not otherwise interesting - the claim is that there should not be one.

/** The diagnostics raised for one table, by the `path` the reflector reports. */
const forTable = (table: string): readonly string[] =>
  diagnostics.filter(one => one.path === table).map(one => one.reason);

describe('the key comes out in declaration order (frozen: ir/SPEC.md 4.1)', () => {
  // Green today, and worth pinning precisely because it is green by accident of the reflector
  // walking members in source order rather than by decision. §4.1 makes the order normative, and
  // `['tenantId','userId']` — what sorting would give — is a valid key over the same set that
  // builds a different index.
  it('reads the key in the order the interface declares it', () => {
    expect(memberships.primaryKey).toEqual(['userId', 'tenantId']);
  });

  // And the flag agrees with the list, which is §4.1's projection rule seen from the producer's
  // end. Green today; this is the direction that is allowed.
  it('sets the per-column flag for exactly the columns in the key', () => {
    expect(memberships.ir.columns.map(col => [col.name, col.primaryKey])).toEqual([
      ['userId', true],
      ['tenantId', true],
      ['role', false],
    ]);
  });
});

describe('a Serial column in a composite key (frozen: ir/SPEC.md 4.1)', () => {
  // §4.1 refuses it: auto-increment inside a multi-column key is a MySQL-specific shape — the
  // auto-increment column must *lead* the key — and expressing that constraint would let the
  // declaration order of an interface silently decide whether the schema is portable.
  //
  // The message fragments are matched rather than the whole string: the frozen text spans two
  // lines and contains backticks around `Serial`, and the three load-bearing facts are the column,
  // the key in order, and the two ways out.
  it('is refused, naming the column, the key and the two ways out', () => {
    const reasons = forTable('serial_composite');
    expect(reasons.join('\n')).toContain('a `Serial` column cannot be part of a composite primary key');
    expect(reasons.join('\n')).toContain('(key is (id, tenantId))');
    expect(reasons.join('\n')).toContain('give the table a single-column surrogate key or drop `Serial`');
  });

  // The ordinary case, green: a `Serial` column that *is* the whole key is the single most common
  // table in the repository's own fixtures, and the refusal above must not reach it.
  it('is still fine as the whole key', () => {
    expect(serialSingle.primaryKey).toEqual(['id']);
    expect(forTable('serial_single')).toEqual([]);
    expect(serialSingle.ir.columns.find(col => col.name === 'id')?.serial).toBe(true);
  });
});

describe('a table with no key (frozen: ir/SPEC.md 4.1)', () => {
  // §4.1: "A table may declare no key at all, and `primaryKey` is then `[]`. That is a legal IR,
  // not a defect to normalise: a join table written as two `References` columns with no
  // `PrimaryKey` tag is expressible, and the back-ends each refuse it in their own terms."
  //
  // actual today: the IR is produced correctly — `primaryKey` is `[]` and no column is flagged —
  // and the reflector raises a diagnostic anyway:
  //   "no PrimaryKey column. Every table needs one: findById, update and delete build their WHERE
  //    clause from it, and an empty key compiles to a statement with no conditions."
  // With the default `onDiagnostics`, `schemasFrom` throws on it and a build fails.
  //
  // This is a direct contradiction between two frozen specs, not an unimplemented feature: the
  // reflector's own `SPEC.md` requires that refusal under REQ-TF-8 and
  // `schema-values.spec.ts`'s "refuses a missing table name, and a missing primary key" asserts
  // it. #409 cannot resolve it, so the test states what §4.1 says and the divergence is written
  // down in the tests-freeze notes for whoever implements the slice.
  it.fails('is reflected without a diagnostic, because a keyless table is legal IR', () => {
    expect(forTable('keyless')).toEqual([]);
  });

  // The half that is already right, and the reason the diagnostic above is the only thing in the
  // way: the IR itself is exactly what §4.1 describes.
  it('is reflected as an empty key with no column flagged', () => {
    expect(keyless.primaryKey).toEqual([]);
    expect(keyless.ir.columns.map(col => col.primaryKey)).toEqual([false, false]);
  });
});
