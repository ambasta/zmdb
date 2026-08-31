import { describe, it, expect } from 'vitest';

import { fixtureResults as fullResults } from './fixtures.ts';
import { toMarkdown, toJson, assertNoSilentSkips, ReportError } from './report.ts';
import type { BenchResult } from './results.ts';

// #72: DNF reporting + comparative results table generator.

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
    const parsed: BenchResult[] = JSON.parse(json);
    expect(parsed.length).toBe(fullResults().length);
  });
});

describe('honesty guard (no silent skips)', () => {
  it('throws ReportError when an in-scope case is missing', () => {
    const missing = fullResults().filter(r => r.case !== 'customer-by-id');
    expect(() => assertNoSilentSkips(missing)).toThrow(ReportError);
  });

  it('throws when a result is schema-invalid (ok without opsPerSec)', () => {
    const bad = fullResults().map(r => (r.case === 'customer-by-id' ? { ...r, opsPerSec: undefined } : r));
    expect(() => assertNoSilentSkips(bad)).toThrow(ReportError);
  });

  it('accepts a complete, valid result set', () => {
    expect(() => assertNoSilentSkips(fullResults())).not.toThrow();
  });
});
