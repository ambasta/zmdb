import { describe, it, expect } from 'vitest';

import type { CoreSchema } from '../index.ts';
import { toOpenApiComponents } from './index.ts';

// #67: toOpenApiComponents + determinism + E2E golden document.

const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    email: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

const OrderSchema = {
  table: 'orders',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    total: { type: 'numeric', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'orders'>;

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
});
