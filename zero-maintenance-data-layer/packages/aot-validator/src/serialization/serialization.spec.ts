import { describe, it, expect } from 'vitest';
import { stringify, parse } from './index.ts';

// RED PHASE (#51 spec freeze): serializer correctness vs JSON.

describe('stringify correctness', () => {
  const fixtures: unknown[] = [
    { id: 1, name: 'alice', active: true },
    { nested: { a: [1, 2, 3], b: null } },
    'string with "quotes" and \\backslash',
    [1, 'two', false, null],
    { withUndefined: undefined, kept: 1 },
  ];

  for (const [i, v] of fixtures.entries()) {
    it(`fixture ${i} matches JSON.stringify`, () => {
      expect(stringify(v)).toBe(JSON.stringify(v));
    });

    it(`fixture ${i} round-trips`, () => {
      expect(JSON.parse(stringify(v))).toEqual(JSON.parse(JSON.stringify(v)));
    });
  }

  it('bigint throws TypeError (documented policy)', () => {
    expect(() => stringify({ big: 1n })).toThrow(TypeError);
  });
});

describe('parse', () => {
  it('valid JSON yields success + data', () => {
    const r = parse<{ a: number }>('{"a":1}');
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ a: 1 });
  });

  it('malformed JSON yields success:false', () => {
    const r = parse('{not json');
    expect(r.success).toBe(false);
  });
});
