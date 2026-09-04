import type { TypeIR } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { is, random, makeRng } from './utilities/index.js';

describe('Seedable PRNG Engine & Deterministic Mock Value Generation', () => {
  const userIR: TypeIR = {
    kind: 'object',
    properties: [
      {
        name: 'id',
        optional: false,
        readonly: false,
        type: { kind: 'scalar', scalar: 'integer', constraints: { minimum: 1, maximum: 10000 } },
      },
      {
        name: 'username',
        optional: false,
        readonly: false,
        type: { kind: 'scalar', scalar: 'string', constraints: { minLength: 3, maxLength: 20 } },
      },
      {
        name: 'role',
        optional: false,
        readonly: false,
        type: {
          kind: 'union',
          members: [
            { kind: 'literal', value: 'admin' },
            { kind: 'literal', value: 'moderator' },
            { kind: 'literal', value: 'user' },
          ],
        },
      },
      {
        name: 'score',
        optional: false,
        readonly: false,
        type: { kind: 'scalar', scalar: 'integer', constraints: { minimum: 0 } },
      },
      { name: 'isActive', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'boolean' } },
    ],
  };

  it('outputs identical data sequences across repeated generation runs when using identical PRNG seeds', () => {
    const seed = 987654321;

    const run1 = random(userIR, seed);
    const run2 = random(userIR, seed);

    expect(run1).toEqual(run2);

    const sequence1 = Array.from({ length: 10 }, () => random(userIR, seed));
    const sequence2 = Array.from({ length: 10 }, () => random(userIR, seed));

    expect(sequence1).toEqual(sequence2);
  });

  it('produces different sequences when initialized with different PRNG seeds', () => {
    const runSeedA = random(userIR, 1111);
    const runSeedB = random(userIR, 2222);

    expect(runSeedA).not.toEqual(runSeedB);
  });

  it('generated seeded mock values always satisfy the descriptor validator boolean check', () => {
    const seed = 42;
    for (let i = 0; i < 50; i++) {
      const mockVal = random(userIR, seed + i);
      expect(is(mockVal, userIR)).toBe(true);
    }
  });

  it('Mulberry32 PRNG function produces identical random float sequences for identical seed', () => {
    const rng1 = makeRng(12345);
    const rng2 = makeRng(12345);

    const values1 = Array.from({ length: 5 }, () => rng1());
    const values2 = Array.from({ length: 5 }, () => rng2());

    expect(values1).toEqual(values2);
  });
});
