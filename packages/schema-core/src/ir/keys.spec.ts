import { describe, expect, it } from 'vitest';

import { schemaFromIR, type ColumnIR, type SchemaIR } from './index.js';

// `SchemaIR.primaryKey` as the single record of the key. Tests freeze for the epic "Composite
// primary keys and expression indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md`
// §4.1.
//
// §4.1 settles a disagreement rather than adding a feature: four back-ends read the key and each
// of them reads something different, three of them reading the single-column case as if it were
// the general one. This file pins the two halves that live in this module — the list is ordered and
// authoritative, and the per-column flag is a one-way projection of it — plus the one input §4.1
// says is not legal.
//
// The reflector's half of §4.1 (declaration order, and the two refusals it owns) is in
// `@zmdb/aot-validator`'s `src/reflect/keys.spec.ts`, because that is where a key is derived from a
// declaration.
//
// The invariant tests began as `it.fails` and were converted when #410 made the ordered list
// authoritative at the `schemaFromIR` boundary.

const column = (name: string, extra: Partial<ColumnIR> = {}): ColumnIR => ({
  name,
  physicalName: name,
  sql: 'integer',
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
  ...extra,
});

/** The flag as §4.1 defines it: `true` exactly when the name is in the list. */
const projectionOf = (ir: SchemaIR): readonly (readonly [string, boolean])[] =>
  ir.columns.map(col => [col.name, ir.primaryKey.includes(col.name)] as const);

/** What the value actually carries, in the same shape, so a failure prints both. */
const flagsOf = (ir: SchemaIR): readonly (readonly [string, boolean])[] =>
  ir.columns.map(col => [col.name, col.primaryKey] as const);

describe('the key is the list (frozen: ir/SPEC.md 4.1)', () => {
  // The list is passed through verbatim: not sorted, not deduplicated, not reordered to match the
  // column order. §4.1's reason is that two consumers read the order — the trailing
  // `PRIMARY KEY (…)` clause and the index a planner picks for a prefix lookup — so `(orgId,
  // userId)` and `(userId, orgId)` are the same set and different indexes.
  //
  // Green today, and asserted so that a slice which starts *deriving* the list (from the flags, or
  // from the column order) cannot land: `columns` here is alphabetical and `primaryKey` is not, so
  // any derivation from column order produces the other answer.
  it('keeps the key in the order it was given, not the column order', () => {
    const ir: SchemaIR = {
      table: 'memberships',
      physicalTable: 'memberships',
      columns: [column('orgId'), column('role', { sql: 'text' }), column('userId')],
      primaryKey: ['userId', 'orgId'],
      relations: [],
      foreignKeys: [],
    };
    expect(schemaFromIR(ir).primaryKey).toEqual(['userId', 'orgId']);
  });

  it('projects an ordered declared key into physical column names', () => {
    const ir: SchemaIR = {
      table: 'memberships',
      physicalTable: 'membership_rows',
      columns: [column('orgId', { physicalName: 'org_id' }), column('userId', { physicalName: 'user_id' })],
      primaryKey: ['userId', 'orgId'],
      relations: [],
      foreignKeys: [],
    };

    expect(schemaFromIR(ir).primaryKey).toEqual(['user_id', 'org_id']);
  });

  // A table with no key at all is legal IR. §4.1: "not a defect to normalise: a join table written
  // as two `References` columns with no `PrimaryKey` tag is expressible, and the back-ends each
  // refuse it in their own terms". Green here, and the two back-end halves are asserted where they
  // live — `@zmdb/repository`'s `src/typed-methods/key-arguments.spec.ts` for the throw, and this
  // package's reflector spec for the derivation that currently disagrees.
  it('accepts a table with no key at all', () => {
    const ir: SchemaIR = {
      table: 'audit_log',
      physicalTable: 'audit_log',
      columns: [column('at', { sql: 'timestamp' }), column('what', { sql: 'text' })],
      primaryKey: [],
      relations: [],
      foreignKeys: [],
    };
    expect(schemaFromIR(ir).primaryKey).toEqual([]);
  });

  // The one input §4.1 rules out: "What is _not_ legal is a `primaryKey` naming a column the table
  // does not have". The consequence is a `PRIMARY KEY ("userId", "orgId")` clause over a column
  // that is not in the `CREATE TABLE`, which every dialect rejects at migration time — one step
  // too late, and with the dialect's error rather than the schema's.
  //
  // The refusal is asserted here rather than in the reflector spec, which is a divergence from
  // §4.1's own wording: it says "the reflector refuses that at derivation". The reflector cannot,
  // and not for want of trying — it derives the key from `PrimaryKey` tags on columns it is
  // walking, so a key naming a column that does not exist is unreachable from any declaration.
  // The only entry points for a phantom key are the ones that hand-write `SchemaIR`: generated
  // code, `zmdb introspect`'s output, and `schemaFromIR` called directly, which is exported. So
  // the check has to be here or it is nowhere. Recorded in the tests-freeze notes as a spec
  // correction rather than silently reassigned.
  //
  it('refuses a key naming a column the table does not have', () => {
    const ir: SchemaIR = {
      table: 'memberships',
      physicalTable: 'memberships',
      columns: [column('userId', { primaryKey: true })],
      primaryKey: ['userId', 'orgId'],
      relations: [],
      foreignKeys: [],
    };
    expect(() => schemaFromIR(ir)).toThrow(/memberships/);
    expect(() => schemaFromIR(ir)).toThrow(/orgId/);
  });
});

describe('the flag is a projection of the list (frozen: ir/SPEC.md 4.1)', () => {
  // §4.1 fixes the direction: `ColumnIR.primaryKey` is `true` exactly when the column's name
  // appears in `SchemaIR.primaryKey`, and "nothing may reconstruct the list by filtering columns
  // on the flag, because the flag has lost the one fact the list carries".
  //
  // The assertion is on the *invariant* rather than on a refusal, deliberately. §4.1 says the
  // direction is one-way; it does not say whether an inconsistent input is refused or normalised,
  // and asserting one of those would freeze a decision the spec left open. Either implementation
  // satisfies this test; a pass-through does not.
  //
  it('never carries a flag the list does not agree with', () => {
    const ir: SchemaIR = {
      table: 't',
      physicalTable: 't',
      columns: [column('a', { primaryKey: true }), column('b', { primaryKey: true })],
      primaryKey: ['a'],
      relations: [],
      foreignKeys: [],
    };
    const value = schemaFromIR(ir);
    expect(flagsOf(value.ir)).toEqual(projectionOf(value.ir));
  });

  // And the other direction, which is the one that loses a key column rather than inventing one.
  //
  it('never omits a flag for a column the list names', () => {
    const ir: SchemaIR = {
      table: 't',
      physicalTable: 't',
      columns: [column('a', { primaryKey: false })],
      primaryKey: ['a'],
      relations: [],
      foreignKeys: [],
    };
    const value = schemaFromIR(ir);
    expect(flagsOf(value.ir)).toEqual(projectionOf(value.ir));
  });

  // The consistent case, green, so the invariant above is pinned from both sides: a value that
  // already agrees must keep agreeing, or the two tests above could be satisfied by throwing on
  // everything.
  it('agrees with itself for a well-formed composite key', () => {
    const ir: SchemaIR = {
      table: 'memberships',
      physicalTable: 'memberships',
      columns: [
        column('orgId', { primaryKey: true }),
        column('role', { sql: 'text' }),
        column('userId', { primaryKey: true }),
      ],
      primaryKey: ['userId', 'orgId'],
      relations: [],
      foreignKeys: [],
    };
    const value = schemaFromIR(ir);
    expect(flagsOf(value.ir)).toEqual(projectionOf(value.ir));
    expect(flagsOf(value.ir)).toEqual([
      ['orgId', true],
      ['role', false],
      ['userId', true],
    ]);
  });
});
