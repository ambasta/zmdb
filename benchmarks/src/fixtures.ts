// Deterministic result sets for the tests that exercise the *plumbing* —
// reporting, the honesty guard, regression detection — rather than performance.
//
// None of those tests need real timings: they assert shape, ordering, coverage
// and comparison logic, all of which a fixed set of numbers exercises better
// than a live run. Live measurement lives in runner.ts and happens only when a
// human asks for it (`yarn guardrail --live`, `yarn bench`), never in CI.
//
// Derived from IN_SCOPE_CASES so a new case cannot appear in the spec and quietly
// stay out of the fixtures.
import { IN_SCOPE_CASES, type BenchResult } from './results.ts';

// The ORM cases the architecture rejects outright — reported as visible DNF by
// runOrmSuite, and mirrored here so the fixture has both statuses in it.
const ANTI_PATTERN = new Set(['lazy-relation-graph', 'identity-map-dedup', 'active-record-save']);

/** A full, schema-valid matrix for the primary target: every in-scope case, ok or dnf. */
export function fixtureResults(target = 'zmdb'): BenchResult[] {
  const validation: BenchResult[] = IN_SCOPE_CASES.validation.map(c => ({
    suite: 'validation',
    case: c,
    target,
    status: 'ok',
    opsPerSec: 1000,
  }));
  const orm: BenchResult[] = IN_SCOPE_CASES.orm.map(c =>
    ANTI_PATTERN.has(c)
      ? { suite: 'orm', case: c, target, status: 'dnf', dnfReason: 'dnf (anti-pattern): rejected' }
      : { suite: 'orm', case: c, target, status: 'ok', opsPerSec: 500 },
  );
  return [...validation, ...orm];
}
