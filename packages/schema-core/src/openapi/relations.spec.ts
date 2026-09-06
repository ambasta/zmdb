import { schemasFrom } from '@zmdb/compiler/testing';
import { describe, it, expect } from 'vitest';

import type { ManyToOne, OneToMany, PrimaryKey, References, Serial, Sql, Table } from '../tags/index.js';
import { toJsonSchemaWithRelations } from './index.js';

// #66: DTO-aware generation + relation $refs.
//
// The relations used to be a second argument — `{ user: manyToOne('users', 'userId') }` — so a
// document could name a relation the table did not have, or miss one it did. They come off
// `schema.ir` now, which is read from the declarations below.

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  user?: User & ManyToOne<'users', 'userId'>;
}

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  orders?: Order[] & OneToMany<'orders', 'userId'>;
}

const { Order: OrderSchema, User: UserSchema } = schemasFrom(import.meta.url, ['Order', 'User']);

describe('relation $refs', () => {
  it('emits a $ref for a to-one relation', () => {
    const s = toJsonSchemaWithRelations(OrderSchema, 'entity');
    expect(s.properties.user).toEqual({ $ref: '#/components/schemas/User' });
  });

  it('emits an array of $ref for a to-many relation', () => {
    const s = toJsonSchemaWithRelations(UserSchema, 'entity');
    expect(s.properties.orders).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Order' },
    });
  });

  it('relations are omitted from create/update variants (input bodies)', () => {
    const s = toJsonSchemaWithRelations(OrderSchema, 'create');
    expect(s.properties.user).toBeUndefined();
  });

  it('keeps the foreign key column, which is a column and not a relation', () => {
    // `userId` is how a client writes the relation on a create, so it has to stay.
    expect(toJsonSchemaWithRelations(OrderSchema, 'create').properties.userId).toEqual({ type: 'integer' });
  });
});
