import { describe, it, expect } from 'vitest';

import { attachPopulated } from './index.js';

// `PopulatedEntity`'s widening is asserted in `relations.type-test.ts`.
describe('Populated<S,K> result typing (#190)', () => {
  it('attachPopulated attaches a to-many relation (non-mutating)', () => {
    const user = { id: 1, name: 'a' };
    const populated = attachPopulated(user, 'orders', [{ id: 10, total: 5 }]);
    expect(populated).toEqual({ id: 1, name: 'a', orders: [{ id: 10, total: 5 }] });
    expect(user).toEqual({ id: 1, name: 'a' }); // input unchanged
  });

  it('attachPopulated attaches a to-one relation', () => {
    const order = { id: 10, total: 5 };
    const populated = attachPopulated(order, 'user', { id: 1, name: 'a' });
    expect(populated.user).toEqual({ id: 1, name: 'a' });
  });
});
