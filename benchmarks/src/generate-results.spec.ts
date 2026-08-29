import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runValidationSuite, zmdbAdapter } from './validation/adapter.ts';
import { seed, runOrmSuite, competitorDnf, type OrmEngine } from './orm/adapter.ts';
import { toMarkdown } from './report.ts';
import type { BenchResult } from './results.ts';

// Generates benchmarks/RESULTS.md from LIVE runs (validation + ORM against
// node:sqlite), using the #72 report generator (single source of truth for
// formatting + honesty guard). Competitor rows are honest DNF.

function generate(): BenchResult[] {
  const desc = {
    kind: 'object' as const,
    fields: { id: { kind: 'number' as const, minimum: 0 }, email: { kind: 'string' as const } },
  };
  const valid = runValidationSuite('zmdb', zmdbAdapter, desc, { id: 1, email: 'a@b.com' }, 500);

  const db = new DatabaseSync(':memory:');
  const engine: OrmEngine = {
    exec: (s) => db.exec(s),
    all: (s, p) => db.prepare(s).all(...(p as unknown[])) as Record<string, unknown>[],
  };
  seed(engine, 50, 4);
  const orm = [...runOrmSuite(engine, 200), ...competitorDnf()];
  return [...valid, ...orm];
}

describe('benchmark RESULTS.md generation (live)', () => {
  it('writes a schema-valid, deterministically-ordered RESULTS.md via the #72 generator', () => {
    const md = toMarkdown(generate()); // throws if any in-scope case is missing
    // Deterministic ordering (numbers aside): regenerating yields same shape.
    const shape = (s: string) => s.replace(/\d+ ops\/s/g, 'N ops/s');
    expect(shape(toMarkdown(generate()))).toBe(shape(md));

    const here = dirname(fileURLToPath(import.meta.url));
    writeFileSync(join(here, '..', 'RESULTS.md'), md);
    expect(md).toContain('dnf (anti-pattern)');
    expect(md).toContain('dnf (not implemented)');
  });
});
