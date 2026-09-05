import { describe, it, expect } from 'vitest';

import { transform } from './index.js';

// #47: transform rule construction. Tests written BEFORE implementation (TDD).
// A transform rule carries a pure conversion for a caller to apply after validation.
// The conversion is a real function (no `new Function`): CSP-safe, and typechecked
// at the call site. Its intrinsic source is retained for inspection, but no current
// validator path applies or emits this advanced rule.

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

  it('records the intrinsic function source for inspection', () => {
    const rule = transform(v => Number(v) * 2);
    expect(rule.source).toContain('Number(v) * 2');
  });

  it('rejects JavaScript callers before a transform source can become a rule', () => {
    const sources = [
      "v.constructor.constructor('return process.pid')()",
      "v['constructor']['constructor']('return process.pid')()",
      "v.__proto__.constructor.constructor('return process.pid')()",
      "v['__proto__']['constructor']['constructor']('return process.pid')()",
      "v.constructor.prototype.constructor.constructor('return process.pid')()",
      "v['constructor']['prototype']['constructor']['constructor']('return process.pid')()",
    ];

    for (const source of sources) {
      expect(() => Reflect.apply(transform, undefined, [source])).toThrow(
        'transform() requires a function value; source strings are not supported',
      );
    }
  });
});
