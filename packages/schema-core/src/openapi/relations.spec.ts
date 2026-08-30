import { describe, it, expect } from 'vitest';

import type { CoreSchema } from '../index.ts';
import { manyToOne, oneToMany } from '../relations/index.ts';
import { toJsonSchemaWithRelations } from './index.ts';

// #66: DTO-aware generation + relation $refs. Tests first (TDD).

const OrderSchema = {
  table: 'orders',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    userId: { type: 'integer', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'orders'>;

const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

describe('relation $refs', () => {
  it('emits a $ref for a to-one relation', () => {
    const s = toJsonSchemaWithRelations(OrderSchema, { user: manyToOne('users', 'userId') }, 'entity');
    expect(s.properties.user).toEqual({ $ref: '#/components/schemas/User' });
  });

  it('emits an array of $ref for a to-many relation', () => {
    const s = toJsonSchemaWithRelations(UserSchema, { orders: oneToMany('orders', 'userId') }, 'entity');
    expect(s.properties.orders).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Order' },
    });
  });

  it('relations are omitted from create/update variants (input bodies)', () => {
    const s = toJsonSchemaWithRelations(OrderSchema, { user: manyToOne('users', 'userId') }, 'create');
    expect(s.properties.user).toBeUndefined();
  });
});
