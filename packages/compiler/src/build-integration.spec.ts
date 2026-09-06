import { tags, validate } from '@zmdb/aot-validator';
import { describe, it, expect } from 'vitest';

import { transformCode } from './transform/index.js';

// #24: runtime-safety fallback + build integration.
// Contract: the inlined (transformed) code must behave identically to the
// runtime fallback validate(), so pre- and post-transform behavior match.

// Evaluate an inlined boolean expression produced by the transformer.
function evalInlined(expr: string, input: unknown): boolean {
  // The transformer turns `validate(tags.X(...), E)` into a bare boolean expr.
  const src = transformCode(`validate(${expr}, input)`);
  return new Function('input', `return (${src});`)(input) as boolean;
}

describe('transform ≡ runtime fallback (build integration)', () => {
  const cases: { expr: string; rule: () => ReturnType<typeof tags.Min>; good: unknown; bad: unknown }[] = [
    { expr: 'tags.Min(0)', rule: () => tags.Min(0), good: 5, bad: -1 },
    { expr: 'tags.MaxLength(3)', rule: () => tags.MaxLength(3), good: 'ab', bad: 'abcd' },
    { expr: 'tags.Enum("a","b")', rule: () => tags.Enum('a', 'b'), good: 'a', bad: 'c' },
  ];

  for (const c of cases) {
    it(`${c.expr}: inlined matches runtime for good input`, () => {
      expect(evalInlined(c.expr, c.good)).toBe(validate(c.rule(), c.good));
      expect(evalInlined(c.expr, c.good)).toBe(true);
    });
    it(`${c.expr}: inlined matches runtime for bad input`, () => {
      expect(evalInlined(c.expr, c.bad)).toBe(validate(c.rule(), c.bad));
      expect(evalInlined(c.expr, c.bad)).toBe(false);
    });
  }
});
