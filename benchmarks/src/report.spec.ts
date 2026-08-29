import { describe, it, expect } from 'vitest';
import { toMarkdown, toJson, assertNoSilentSkips, ReportError } from './report.ts';
import { IN_SCOPE_CASES, type BenchResult } from './results.ts';

// #72: DNF reporting + comparative results table generator.

// A full, valid result set for one target in each suite.
function fullResults(): BenchResult[] {
  const validation: BenchResult[] = IN_SCOPE_CASES.validation.map((c) => ({
    suite: 'validation',
    case: c,
    target: 'zmdb',
    status: 'ok',
    opsPerSec: 1000,
  }));
  const antiPattern = new Set(['lazy-relation-graph', 'identity-map-dedup', 'active-record-save']);
  const orm: BenchResult[] = IN_SCOPE_CASES.orm.map((c) =>
    antiPattern.has(c)
      ? { suite: 'orm', case: c, target: 'zmdb', status: 'dnf', dnfReason: 'dnf (anti-pattern): rejected' }
      : { suite: 'orm', case: c, target: 'zmdb', status: 'ok', opsPerSec: 500 },
  );
  return [...validation, ...orm];
}

describe('report generator', () => {
  it('renders Markdown with explicit DNF rows, deterministically ordered', () => {
    const md = toMarkdown(fullResults());
    expect(md).toContain('| Suite | Case | Target | Result |');
    expect(md).toContain('dnf (anti-pattern): rejected');
    // Deterministic: regenerating yields identical output.
    expect(toMarkdown(fullResults())).toBe(md);
  });

  it('emits JSON that round-trips to the same sorted set', () => {
    const json = toJson(fullResults());
    const parsed = JSON.parse(json) as BenchResult[];
    expect(parsed.length).toBe(fullResults().length);
  });
});

describe('honesty guard (no silent skips)', () => {
  it('throws ReportError when an in-scope case is missing', () => {
    const missing = fullResults().filter((r) => r.case !== 'customer-by-id');
    expect(() => assertNoSilentSkips(missing)).toThrow(ReportError);
  });

  it('throws when a result is schema-invalid (ok without opsPerSec)', () => {
    const bad = fullResults().map((r) =>
      r.case === 'customer-by-id' ? { ...r, opsPerSec: undefined } : r,
    );
    expect(() => assertNoSilentSkips(bad)).toThrow(ReportError);
  });

  it('accepts a complete, valid result set', () => {
    expect(() => assertNoSilentSkips(fullResults())).not.toThrow();
  });
});
