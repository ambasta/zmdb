// @zmdb/benchmarks — results schema + report helpers (red phase, #69).
// Implementation of the generator lands in #72; the schema validator here is
// what the spec-freeze tests pin.


export type ResultStatus = 'ok' | 'dnf';

export interface BenchResult {
  readonly suite: 'validation' | 'orm';
  readonly case: string;
  readonly target: string;
  readonly status: ResultStatus;
  readonly opsPerSec?: number;
  readonly dnfReason?: string;
}

// The set of in-scope case ids per suite (frozen in SPEC.md). Every in-scope
// case MUST appear (as ok or dnf) for a given target — never silently omitted.
export const IN_SCOPE_CASES: Readonly<Record<'validation' | 'orm', readonly string[]>> = Object.freeze({
  validation: Object.freeze(['safe-parse', 'strict-parse', 'loose-assert', 'strict-assert']),
  orm: Object.freeze([
    'customer-by-id',
    'products-search',
    'order-with-items',
    'top-products',
    'prepared-reuse',
    'lazy-relation-graph',
    'identity-map-dedup',
    'active-record-save',
  ]),
});

export interface SchemaError {
  readonly path: string;
  readonly message: string;
}

// Validate a single result record against the frozen schema rules.
export function validateResult(r: BenchResult): readonly SchemaError[] {
  const errors: SchemaError[] = [];
  if (r.status === 'ok' && typeof r.opsPerSec !== 'number') {
    errors.push({ path: `${r.suite}.${r.case}.${r.target}`, message: 'ok result must carry opsPerSec' });
  }
  if (r.status === 'dnf' && (!r.dnfReason || r.dnfReason.length === 0)) {
    errors.push({ path: `${r.suite}.${r.case}.${r.target}`, message: 'dnf result must carry a non-empty dnfReason' });
  }
  return errors;
}

// Validate that a target's result set covers EVERY in-scope case for a suite
// (each present as ok or dnf). Returns errors for missing/duplicate cases.
export function validateCoverage(
  suite: 'validation' | 'orm',
  target: string,
  results: readonly BenchResult[],
): readonly SchemaError[] {
  const errors: SchemaError[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.suite !== suite || r.target !== target) continue;
    if (seen.has(r.case)) {
      errors.push({ path: `${suite}.${r.case}.${target}`, message: `duplicate case "${r.case}"` });
    }
    seen.add(r.case);
  }
  for (const c of IN_SCOPE_CASES[suite]) {
    if (!seen.has(c)) {
      errors.push({ path: `${suite}.${c}.${target}`, message: `in-scope case "${c}" is missing (must be ok or dnf, never silently omitted)` });
    }
  }
  return errors;
}
