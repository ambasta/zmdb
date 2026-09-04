import { describe, it, expect } from 'vitest';

import { flattenEmbeddable, liftEmbeddable } from './index.js';

describe('embeddables (#146)', () => {
  const addr = { street: '1 Main', city: 'Metropolis', zip: '00001' };

  it('flatten prefixes each field with the column prefix', () => {
    expect(flattenEmbeddable('address', addr)).toEqual({
      address_street: '1 Main',
      address_city: 'Metropolis',
      address_zip: '00001',
    });
  });

  it('lift extracts prefixed columns back into a value object', () => {
    const row = { id: 1, address_street: '1 Main', address_city: 'Metropolis', address_zip: '00001' };
    expect(liftEmbeddable('address', row)).toEqual(addr);
  });

  it('round-trips', () => {
    expect(liftEmbeddable('address', flattenEmbeddable('address', addr))).toEqual(addr);
  });
});
