import { describe, it, expect } from 'vitest';

import { transform } from './index.ts';

// #47: transform compilation. Tests written BEFORE implementation (TDD).
// A transform rule carries a pure conversion applied AFTER validation passes.
// The conversion is a real function (no `new Function`): CSP-safe, and typechecked
// at the call site. Its source is still recoverable for AOT inlining.

describe('transform', () => {
  it('produces a transform rule that applies the conversion', () => {
    const rule = transform(v => String(v).trim());
    // Rule shape is inspectable; `apply` is part of the returned type.
    expect(rule.kind).toBe('transform');
    expect(rule.apply('  hi  ')).toBe('hi');
  });

  it('supports numeric conversions', () => {
    const rule = transform(v => Number(v) * 2);
    expect(rule.apply(21)).toBe(42);
  });

  it('carries inlineable source for the AOT emitter', () => {
    const rule = transform(v => Number(v) * 2);
    expect(rule.source).toContain('Number(v) * 2');
  });
});
