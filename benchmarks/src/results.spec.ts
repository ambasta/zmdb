import { describe, it, expect } from 'vitest';

import { validateResult, validateCoverage, IN_SCOPE_CASES, type BenchResult } from './results.ts';

// RED PHASE (#69 spec freeze): result schema + coverage rules, incl. DNF.

describe('validateResult', () => {
  it('accepts an ok result carrying opsPerSec', () => {
    const r: BenchResult = { suite: 'orm', case: 'customer-by-id', target: 'zmdb', status: 'ok', opsPerSec: 12345 };
    expect(validateResult(r)).toEqual([]);
  });

  it('rejects an ok result missing opsPerSec', () => {
    const r: BenchResult = { suite: 'orm', case: 'customer-by-id', target: 'zmdb', status: 'ok' };
    expect(validateResult(r).length).toBeGreaterThan(0);
  });

  it('accepts a dnf result carrying a reason', () => {
    const r: BenchResult = {
      suite: 'orm',
      case: 'lazy-relation-graph',
      target: 'zmdb',
      status: 'dnf',
      dnfReason: 'dnf (anti-pattern): proxy lazy-load rejected',
    };
    expect(validateResult(r)).toEqual([]);
  });

  it('rejects a dnf result missing a reason', () => {
    const r: BenchResult = { suite: 'orm', case: 'lazy-relation-graph', target: 'zmdb', status: 'dnf' };
    expect(validateResult(r).length).toBeGreaterThan(0);
  });
});

describe('validateCoverage (no in-scope case silently omitted)', () => {
  it('passes when every in-scope validation case is present (ok or dnf)', () => {
    const results: BenchResult[] = IN_SCOPE_CASES.validation.map(c => ({
      suite: 'validation',
      case: c,
      target: 'zmdb',
      status: 'ok',
      opsPerSec: 1000,
    }));
    expect(validateCoverage('validation', 'zmdb', results)).toEqual([]);
  });

  it('fails when an in-scope case is missing', () => {
    const results: BenchResult[] = IN_SCOPE_CASES.validation
      .slice(1) // drop one → coverage gap
      .map(c => ({ suite: 'validation', case: c, target: 'zmdb', status: 'ok', opsPerSec: 1000 }));
    expect(validateCoverage('validation', 'zmdb', results).length).toBeGreaterThan(0);
  });

  it('counts a DNF row as covering its case', () => {
    const results: BenchResult[] = IN_SCOPE_CASES.orm.map(c =>
      c.startsWith('lazy') || c.startsWith('identity') || c.startsWith('active')
        ? { suite: 'orm', case: c, target: 'zmdb', status: 'dnf', dnfReason: 'dnf (anti-pattern): rejected' }
        : { suite: 'orm', case: c, target: 'zmdb', status: 'ok', opsPerSec: 1000 },
    );
    expect(validateCoverage('orm', 'zmdb', results)).toEqual([]);
  });
});
