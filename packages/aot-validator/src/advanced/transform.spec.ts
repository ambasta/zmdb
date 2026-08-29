import { describe, it, expect } from 'vitest';
import { transform } from './index.ts';

// #47: transform compilation. Tests written BEFORE implementation (TDD).
// A transform rule carries a pure conversion applied AFTER validation passes.

describe('transform', () => {
  it('produces a transform rule that applies the conversion', () => {
    const rule = transform('v.trim()');
    // Rule shape is inspectable; the runtime fallback exposes the fn.
    expect(rule.kind).toBe('transform');
    const applied = (rule as unknown as { apply: (v: unknown) => unknown }).apply('  hi  ');
    expect(applied).toBe('hi');
  });

  it('supports numeric conversions', () => {
    const rule = transform('v * 2');
    const applied = (rule as unknown as { apply: (v: unknown) => unknown }).apply(21);
    expect(applied).toBe(42);
  });
});
