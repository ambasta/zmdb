import { describe, it, expect } from 'vitest';

import { tags } from '../index.js';
import { union, discriminated, evalRule } from './index.js';

// #48: union / discriminated-union compilation. Tests first (TDD).

describe('union', () => {
  it('matches when any branch matches (ordered short-circuit)', () => {
    const rule = union(tags.Min(100), tags.MaxLength(3));
    expect(evalRule(rule, 150)).toBe(true); // matches Min(100)
    expect(evalRule(rule, 'ab')).toBe(true); // matches MaxLength(3)
    expect(evalRule(rule, 'abcdef')).toBe(false); // neither
    expect(evalRule(rule, 5)).toBe(false); // neither (5 < 100, not a string)
  });
});

describe('discriminated union', () => {
  it('switches on the discriminant key', () => {
    const rule = discriminated('kind', {
      a: tags.Min(0),
      b: tags.MaxLength(2),
    });
    expect(evalRule(rule, { kind: 'a', value: 5 })).toBe(true);
    expect(evalRule(rule, { kind: 'b', value: 'xy' })).toBe(true);
    expect(evalRule(rule, { kind: 'b', value: 'xyz' })).toBe(false);
    expect(evalRule(rule, { kind: 'unknown' })).toBe(false);
  });
});
