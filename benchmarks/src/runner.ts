import { DatabaseSync } from 'node:sqlite';
import { runValidationSuite, zmdbAdapter } from './validation/adapter.ts';
import { seed, runOrmSuite, competitorDnf, type OrmEngine } from './orm/adapter.ts';
import type { BenchResult } from './results.ts';

/**
 * Runs live benchmark suites (validation + ORM against node:sqlite) and returns
 * the array of BenchResult records.
 */
export function runLiveBenchmarks(): BenchResult[] {
  const desc = {
    kind: 'object' as const,
    fields: { id: { kind: 'number' as const, minimum: 0 }, email: { kind: 'string' as const } },
  };
  const valid = runValidationSuite('zmdb', zmdbAdapter, desc, { id: 1, email: 'a@b.com' }, 1000);

  const db = new DatabaseSync(':memory:');
  const engine: OrmEngine = {
    exec: (s) => db.exec(s),
    all: (s, p) => db.prepare(s).all(...(p as any[])) as Record<string, unknown>[],
  };
  seed(engine, 50, 4);
  const orm = [...runOrmSuite(engine, 1000), ...competitorDnf()];
  return [...valid, ...orm];
}
