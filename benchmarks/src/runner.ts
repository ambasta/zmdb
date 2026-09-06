import { DatabaseSync } from 'node:sqlite';

import { schemaIrsFrom } from '@zmdb/compiler/testing';
import { objectTypeFromIR } from '@zmdb/schema-core/ir';
import type { Min, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

import { seed, runOrmSuite, competitorDnf, type OrmEngine } from './orm/adapter.js';
import type { BenchResult } from './results.js';
import { runValidationSuite, zmdbAdapter } from './validation/adapter.js';

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

/** The shape the validation suite measures. Declared, not built. */
export interface Users extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  count: number & Sql<'integer'> & Min<0>;
  email: string & Sql<'text'>;
}

/**
 * Runs live benchmark suites (validation + ORM against node:sqlite) and returns
 * the array of BenchResult records.
 */
export function runLiveBenchmarks(): BenchResult[] {
  // Derived, not written: the witness the validation suite runs against is reflected off
  // the interface above, the same way a user's is (REQ-TF-9). This reads the declaration
  // through a compiler session, which costs a few hundred milliseconds once; the measured
  // loops are downstream of it and do not pay for it. An application would let the build
  // do this and get the same IR without the session.
  const { Users: ir } = schemaIrsFrom(import.meta.url, ['Users']);
  const type = objectTypeFromIR(ir, 'entity');
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
