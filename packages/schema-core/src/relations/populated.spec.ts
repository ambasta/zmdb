import { describe, it, expect, expectTypeOf } from 'vitest';
import { attachPopulated, type PopulatedEntity, type RelationDef } from './index.ts';

interface User {
  id: number;
  name: string;
}
interface Order {
  id: number;
  total: number;
}

// A relation map: users have many orders.
interface UserRelations {
  orders: RelationDef & { cardinality: 'one-to-many'; entity: Order };
  [k: string]: RelationDef;
}

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

  it('type-level: PopulatedEntity widens Base with the relation field', () => {
    type P = PopulatedEntity<User, UserRelations, 'orders'>;
    expectTypeOf<P['orders']>().toEqualTypeOf<Order[]>();
    expectTypeOf<P['id']>().toEqualTypeOf<number>();
  });
});
