// One column, three types, one place they have to agree (plan D3).
//
// A column has a **db** type (what the dialect declares), an **app** type (what handler
// code holds) and a **wire** type (what a JSON body contains). For a `timestamp` those
// are three different answers — `TIMESTAMPTZ`, `Date`, ISO-8601 string — and for a long
// time zmdb gave four: the DDL emitter interpolated the word `timestamp` into every
// dialect, so Postgres stored it without a zone and dropped the offset of every `Date`
// written to it; the repository's own check accepted `Date | string`, so neither of the
// other two was ever the one being tested; and only the published JSON Schema was right.
//
// Nothing above catches that, because each of the three lives in a different package and
// each was self-consistent. This file is the only place all three are asked at once, from
// a single `defineSchema` call, which is why it lives in the umbrella package — the one
// that depends on all of them.

import { issuesFor } from '@zmdb/aot-validator/utilities';
import type { Dialect } from '@zmdb/query-compiler';
import { emitUp, snapshot, type ChangeOp } from '@zmdb/query-compiler/migrations';
import { describe, expect, it } from 'vitest';

import { defineSchema, serial, text, timestamp } from './index.ts';
import { appTypeOf, irFromSchema, jsonSchemaFromIR, objectTypeFromIR, wireTypeOf, type ColumnIR } from './ir.ts';

const Events = defineSchema('events', {
  id: serial().primaryKey(),
  name: text(),
  at: timestamp(),
});

const AT = irFromSchema(Events).columns.find(c => c.name === 'at') as ColumnIR;

const ISO = '2026-01-01T12:30:00.000Z';
const WHEN = new Date(ISO);

/** The `CREATE TABLE` a migration would generate for this schema, in one dialect. */
function ddl(dialect: Dialect): string {
  const table = snapshot([Events]).tables[0];
  if (!table) throw new Error('no table in the snapshot');
  const create: ChangeOp = { kind: 'create_table', table: table.name, columns: table.columns };
  return emitUp(create, dialect);
}

describe('a timestamp column, in all three of its types', () => {
  // The db type. Per dialect, because "what is a timestamp" is the question each dialect
  // answers differently and the one the emitter used to not ask at all.
  // The whole statement, not a fragment: the abstract word `timestamp` reaching the DDL is
  // the regression, and matching a fragment is how it hid — `TIMESTAMPTZ` contains
  // `TIMESTAMP`, so half the obvious assertions pass either way.
  const DB: Readonly<Record<Dialect, string>> = {
    postgres: 'CREATE TABLE "events" ("at" TIMESTAMPTZ NOT NULL, "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL)',
    mysql:
      'CREATE TABLE `events` (`at` DATETIME(3) NOT NULL, `id` INT AUTO_INCREMENT PRIMARY KEY, `name` TEXT NOT NULL)',
    sqlite: 'CREATE TABLE "events" ("at" TEXT NOT NULL, "id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)',
  };

  for (const [dialect, statement] of Object.entries(DB) as [Dialect, string][]) {
    it(`declares the column the way ${dialect} spells it`, () => {
      expect(ddl(dialect)).toBe(statement);
    });
  }

  it('is a Date to the app, and an ISO string is not one', () => {
    expect(appTypeOf(AT)).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(issuesFor(WHEN, appTypeOf(AT))).toEqual([]);
    expect(issuesFor(ISO, appTypeOf(AT))).toEqual([
      { path: 'input', message: 'expected Date', expected: 'Date', value: ISO },
    ]);
  });

  it('is an ISO string on the wire, and a Date is not one', () => {
    expect(wireTypeOf(AT)).toEqual({ kind: 'scalar', scalar: 'string', format: 'date-time' });
    expect(issuesFor(ISO, wireTypeOf(AT))).toEqual([]);
    expect(issuesFor(WHEN, wireTypeOf(AT))).toEqual([
      { path: 'input', message: 'expected string', expected: 'string', value: WHEN },
    ]);
  });

  it('is a date-time string in the published document, which is the wire type', () => {
    // Not a coincidence and not a third decision: a published document describes a JSON
    // body, so it is the wire type rendered as JSON Schema.
    expect(jsonSchemaFromIR(irFromSchema(Events), 'create').properties).toMatchObject({
      at: { type: 'string', format: 'date-time' },
    });
  });

  it('validates one layer per call, so a mixed payload is rejected either way', () => {
    // The bug in one line. A single validator that took `Date | string` could not fail
    // here, which is exactly why nobody noticed the DDL was wrong for years.
    const create = objectTypeFromIR(irFromSchema(Events), 'create');
    const wire = objectTypeFromIR(irFromSchema(Events), 'create', 'wire');
    expect(issuesFor({ name: 'launch', at: WHEN }, create)).toEqual([]);
    expect(issuesFor({ name: 'launch', at: ISO }, wire)).toEqual([]);
    expect(issuesFor({ name: 'launch', at: ISO }, create)).toHaveLength(1);
    expect(issuesFor({ name: 'launch', at: WHEN }, wire)).toHaveLength(1);
  });

  it('round-trips wire → app → wire without losing the offset', () => {
    // What the Postgres `TIMESTAMP` bug destroyed. The decode the web pipeline performs at
    // the boundary is `new Date(iso)`, and it has to be lossless for the three types to be
    // three spellings of one value rather than three values.
    expect(new Date(ISO).toISOString()).toBe(ISO);
    expect(WHEN.toISOString()).toBe(ISO);
    // A zoned string is the same instant, and comes back normalised to UTC — the offset is
    // *applied*, not dropped, which is the property `TIMESTAMPTZ` preserves and
    // `TIMESTAMP WITHOUT TIME ZONE` does not.
    expect(new Date('2026-01-01T13:30:00.000+01:00').toISOString()).toBe(ISO);
  });
});
