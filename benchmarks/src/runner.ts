import { DatabaseSync } from 'node:sqlite';

import { defineSchema, integer, serial, text } from '@zmdb/schema-core';
import { irFromSchema, objectTypeFromIR } from '@zmdb/schema-core/ir';

import { seed, runOrmSuite, competitorDnf, type OrmEngine } from './orm/adapter.ts';
import type { BenchResult } from './results.ts';
import { runValidationSuite, zmdbAdapter } from './validation/adapter.ts';

function toSqlInput(val: unknown): string | number | bigint | Uint8Array | null {
  if (
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'bigint' ||
    val === null ||
    val instanceof Uint8Array
  ) {
    return val;
  }
  return String(val);
}

/**
 * Runs live benchmark suites (validation + ORM against node:sqlite) and returns
 * the array of BenchResult records.
 */
export function runLiveBenchmarks(): BenchResult[] {
  // Derived, not written: the witness the validation suite runs against comes from a
  // schema, the same way a user's does (REQ-TF-9).
  const Users = defineSchema('users', {
    id: serial().primaryKey(),
    count: integer().validate({ kind: 'minimum', value: 0 }),
    email: text(),
  });
  const type = objectTypeFromIR(irFromSchema(Users), 'entity');
  const valid = runValidationSuite('zmdb', zmdbAdapter, type, { id: 1, count: 1, email: 'a@b.com' }, 1000);

  const db = new DatabaseSync(':memory:');
  const engine: OrmEngine = {
    exec: s => db.exec(s),
    all: (s, p) => db.prepare(s).all(...p.map(toSqlInput)),
  };
  seed(engine, 50, 4);
  const orm = [...runOrmSuite(engine, 1000), ...competitorDnf()];
  return [...valid, ...orm];
}
