import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, it, expect } from 'vitest';

import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.js';
import { toJsonSchema, toListSchema, toSearchSchema } from './index.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

// The schema value these functions take, read off the interface above the way the build
// would. See `@zmdb/aot-validator/testing` — `schemaOf<User>()` has no runtime, so a test
// with no transform in front of it asks the checker directly.
const { User: UserSchema } = schemasFrom(import.meta.url, ['User']);

describe('OpenAPI get/list/search variants (#174)', () => {
  it('get variant equals the entity response schema', () => {
    expect(toJsonSchema(UserSchema, 'get')).toEqual(toJsonSchema(UserSchema, 'entity'));
  });

  it('list variant is a paged envelope over the entity', () => {
    const s = toListSchema(UserSchema);
    expect(s.type).toBe('object');
    expect(s.properties).toHaveProperty('items');
    expect(s.properties.items).toMatchObject({ type: 'array' });
    expect(s.properties).toHaveProperty('hasMore');
    expect(s.required).toContain('items');
    expect(s.required).toContain('hasMore');
  });

  it('search variant is a list whose items carry optional _score', () => {
    const s = toSearchSchema(UserSchema);
    const items = s.properties.items as { items: { properties: Record<string, unknown> } };
    expect(items.items.properties).toHaveProperty('_score');
  });
});
