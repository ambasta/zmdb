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
// one declaration, which is why it lives in the umbrella package — the one that depends on
// all of them.

import { schemaIrsFrom } from '@zmdb/aot-validator/testing';
import { issuesFor } from '@zmdb/aot-validator/utilities';
import type { Dialect } from '@zmdb/query-compiler';
import { emitUp, snapshot, type ChangeOp } from '@zmdb/query-compiler/migrations';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import {
  appTypeOf,
  decodeWireValue,
  encodeWireValue,
  jsonSchemaFromIR,
  objectTypeFromIR,
  schemaFromIR,
  wireTypeOf,
  type ColumnIR,
} from './ir.js';

export interface Events extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  at: Date & Sql<'timestamp'>;
}

// The IR rather than the schema, because the IR is what two of the three answers are read
// out of; the schema is one conversion further on and only the DDL needs it.
const { Events: IR } = schemaIrsFrom(import.meta.url, ['Events']);
const events = schemaFromIR(IR);

const AT = IR.columns.find(c => c.name === 'at') as ColumnIR;

const ISO = '2026-01-01T12:30:00.000Z';
const WHEN = new Date(ISO);

/** The `format`'s assertion, which the wire type carries as a `pattern`. */
const ISO_PATTERN = '^\\d{4}-\\d{2}-\\d{2}[Tt ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:\\d{2})$';

/** The `CREATE TABLE` a migration would generate for this schema, in one dialect. */
function ddl(dialect: Dialect): string {
  const table = snapshot([events]).tables[0];
  if (!table) throw new Error('no table in the snapshot');
  const create: ChangeOp = {
    kind: 'create_table',
    table: table.name,
    columns: table.columns,
    primaryKey: table.primaryKey,
  };
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
    expect(wireTypeOf(AT)).toEqual({
      kind: 'scalar',
      scalar: 'string',
      format: 'date-time',
      constraints: { pattern: ISO_PATTERN },
    });
    expect(issuesFor(ISO, wireTypeOf(AT))).toEqual([]);
    expect(issuesFor(WHEN, wireTypeOf(AT))).toEqual([
      { path: 'input', message: 'expected string', expected: 'string', value: WHEN },
    ]);
  });

  it('checks the string, rather than only saying it is one', () => {
    // The `format` alone said nothing: it is an annotation in JSON Schema, and neither the
    // runtime walk nor the emitter reads it, so `"tomorrow"` was a valid wire value for a
    // `timestamp` and became an `Invalid Date` one decode later. The pattern is what makes
    // this layer's claim enforceable, and it is checked by the same machinery as any other.
    expect(issuesFor('tomorrow', wireTypeOf(AT))).toHaveLength(1);
    // Valid ISO-8601, refused on purpose: with no offset, `new Date()` reads it as local
    // time, so the instant would depend on which machine parsed it. That is the lost-offset
    // bug `TIMESTAMPTZ` exists to prevent, arriving one layer earlier.
    expect(issuesFor('2026-01-01T12:30:00', wireTypeOf(AT))).toHaveLength(1);
    // A date with no time is a `date`, not a `date-time`.
    expect(issuesFor('2026-01-01', wireTypeOf(AT))).toHaveLength(1);
    // And a zoned one is accepted, because it names an instant.
    expect(issuesFor('2026-01-01T13:30:00.000+01:00', wireTypeOf(AT))).toEqual([]);
  });

  it('is a date-time string in the published document, which is the wire type', () => {
    // Not a coincidence and not a third decision: a published document describes a JSON
    // body, so it is the wire type rendered as JSON Schema.
    expect(jsonSchemaFromIR(IR, 'create').properties).toMatchObject({
      at: { type: 'string', format: 'date-time' },
    });
  });

  it('validates one layer per call, so a mixed payload is rejected either way', () => {
    // The bug in one line. A single validator that took `Date | string` could not fail
    // here, which is exactly why nobody noticed the DDL was wrong for years.
    const create = objectTypeFromIR(IR, 'create');
    const wire = objectTypeFromIR(IR, 'create', 'wire');
    expect(issuesFor({ name: 'launch', at: WHEN }, create)).toEqual([]);
    expect(issuesFor({ name: 'launch', at: ISO }, wire)).toEqual([]);
    expect(issuesFor({ name: 'launch', at: ISO }, create)).toHaveLength(1);
    expect(issuesFor({ name: 'launch', at: WHEN }, wire)).toHaveLength(1);
  });

  it('round-trips wire → app → wire without losing the offset', () => {
    // What the Postgres `TIMESTAMP` bug destroyed. The decode the web pipeline performs at
    // the boundary has to be lossless for the three types to be three spellings of one value
    // rather than three values — so it is asked through the converter the boundary calls,
    // not through `new Date` written out again here. A round trip that only holds for the
    // expression the test happens to use is not a round trip.
    expect(decodeWireValue(AT, ISO)).toEqual(WHEN);
    expect(encodeWireValue(AT, WHEN)).toBe(ISO);
    expect(encodeWireValue(AT, decodeWireValue(AT, ISO))).toBe(ISO);
    // A zoned string is the same instant, and comes back normalised to UTC — the offset is
    // *applied*, not dropped, which is the property `TIMESTAMPTZ` preserves and
    // `TIMESTAMP WITHOUT TIME ZONE` does not.
    expect(encodeWireValue(AT, decodeWireValue(AT, '2026-01-01T13:30:00.000+01:00'))).toBe(ISO);
  });

  it('crosses null, undefined and anything unconvertible without touching them', () => {
    // A converter that produced `new Date('tomorrow')` would hand the app layer an `Invalid
    // Date`, which passes `instanceof Date` and reaches the driver as NULL. Leaving the
    // string alone is what lets the validator say `expected Date` and name the value.
    expect(decodeWireValue(AT, null)).toBeNull();
    expect(decodeWireValue(AT, undefined)).toBeUndefined();
    expect(encodeWireValue(AT, null)).toBeNull();
    expect(decodeWireValue(AT, 'tomorrow')).toBe('tomorrow');
    expect(issuesFor(decodeWireValue(AT, 'tomorrow'), appTypeOf(AT))).toHaveLength(1);
    // Already an app value: encode is what runs on a row, and a row holds a `Date`.
    expect(encodeWireValue(AT, ISO)).toBe(ISO);
  });

  it('leaves a column with nothing to convert exactly as it found it', () => {
    const name = IR.columns.find(c => c.name === 'name') as ColumnIR;
    expect(decodeWireValue(name, 'launch')).toBe('launch');
    expect(encodeWireValue(name, 'launch')).toBe('launch');
  });
});
