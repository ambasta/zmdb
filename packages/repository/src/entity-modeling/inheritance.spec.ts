import { describe, it, expect } from 'vitest';

import { discriminatorFor, rowToSubtype, type SingleTableInheritance } from './index.ts';

const sti: SingleTableInheritance = {
  discriminator: 'kind',
  map: {
    circle: ['radius'],
    rect: ['width', 'height'],
  },
};

describe('inheritance mapping (#149)', () => {
  it('discriminatorFor returns the type tag', () => {
    expect(discriminatorFor(sti, 'circle')).toBe('circle');
  });

  it('rowToSubtype reads the discriminator + subtype columns', () => {
    const row = { id: 1, kind: 'rect', width: 4, height: 5, radius: null };
    const out = rowToSubtype(sti, row);
    expect(out.type).toBe('rect');
    expect(out.data).toEqual({ width: 4, height: 5 });
  });

  it('unknown discriminator ⇒ empty data', () => {
    const out = rowToSubtype(sti, { id: 2, kind: 'triangle' });
    expect(out.type).toBe('triangle');
    expect(out.data).toEqual({});
  });
});
