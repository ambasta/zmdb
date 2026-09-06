import { schemasFrom } from '@zmdb/compiler/testing';
import { describe, it, expect } from 'vitest';

import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.js';
import { toOpenApiComponents } from './index.js';

// #67: toOpenApiComponents + determinism + E2E golden document.
//
// The two schemas were `{ table: 'users', columns: { … } } as unknown as CoreSchema<'users'>` —
// a hand-built value with a double cast, because the literal was missing fields the type has.
// Two problems with that, and the second is the reason this file changed rather than the first:
// a double cast is exactly what the escape-hatch ratchet counts, and a hand-built schema is a
// third spelling of a table, agreeing with neither the declaration nor what the emitter inlines.
// Declaring the interfaces and reflecting them is shorter *and* the shipped path.

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  total: number & Sql<'numeric'>;
}

const { Order: OrderSchema, User: UserSchema } = schemasFrom(import.meta.url, ['User', 'Order']);

describe('toOpenApiComponents', () => {
  it('produces a golden components document (PascalCase keys, sorted)', () => {
    // Pass in reverse order to prove deterministic sorting.
    const c = toOpenApiComponents([OrderSchema, UserSchema]);
    expect(c).toEqual({
      schemas: {
        Order: {
          type: 'object',
          properties: { id: { type: 'integer' }, total: { type: 'number' } },
          required: ['id', 'total'],
        },
        User: {
          type: 'object',
          properties: { email: { type: 'string' }, id: { type: 'integer' } },
          required: ['email', 'id'],
        },
      },
    });
  });

  it('is deterministic: same input (any order) → identical JSON', () => {
    const a = JSON.stringify(toOpenApiComponents([UserSchema, OrderSchema]));
    const b = JSON.stringify(toOpenApiComponents([OrderSchema, UserSchema]));
    expect(a).toBe(b);
  });

  it('keys components by declared tables when physical table names differ', () => {
    const { User: namedUser } = schemasFrom(import.meta.url, ['User'], {
      naming: { table: () => 'application_users' },
    });

    expect(namedUser.table).toBe('application_users');
    expect(Object.keys(toOpenApiComponents([namedUser]).schemas)).toEqual(['User']);
  });
});
