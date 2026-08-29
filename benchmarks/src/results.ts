// @zmdb/benchmarks — results schema + report helpers (red phase, #69).
// Implementation of the generator lands in #72; the schema validator here is
// what the spec-freeze tests pin.

const NOT_IMPL = 'not implemented';

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
export function validateResult(_r: BenchResult): readonly SchemaError[] {
  throw new Error(NOT_IMPL);
}

// Validate that a target's result set covers EVERY in-scope case for a suite
// (each present as ok or dnf). Returns errors for missing/duplicate cases.
export function validateCoverage(
  _suite: 'validation' | 'orm',
  _target: string,
  _results: readonly BenchResult[],
): readonly SchemaError[] {
  throw new Error(NOT_IMPL);
}
