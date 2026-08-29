import { describe, it, expect } from 'vitest';
import { manyToOne, oneToMany, manyToMany } from './index.ts';

// RED PHASE (#30 spec freeze): relation metadata fixtures.

describe('relation builders', () => {
  it('manyToOne is owning with an fk', () => {
    expect(manyToOne('users', 'userId')).toEqual({
      cardinality: 'many-to-one',
      target: 'users',
      fk: 'userId',
      owning: true,
    });
  });

  it('oneToMany is inverse with mappedBy', () => {
    expect(oneToMany('orders', 'userId')).toEqual({
      cardinality: 'one-to-many',
      target: 'orders',
      mappedBy: 'userId',
      owning: false,
    });
  });

  it('manyToMany carries a through join table', () => {
    expect(manyToMany('tags', 'post_tags')).toEqual({
      cardinality: 'many-to-many',
      target: 'tags',
      through: 'post_tags',
      owning: true,
    });
  });

  it('relation metadata is frozen', () => {
    expect(Object.isFrozen(manyToOne('users', 'userId'))).toBe(true);
  });
});
