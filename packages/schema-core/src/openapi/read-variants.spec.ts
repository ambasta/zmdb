import { describe, it, expect } from 'vitest';
import { defineSchema, serial, text } from '../index.ts';
import { toJsonSchema, toListSchema, toSearchSchema } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

describe('OpenAPI get/list/search variants (#174)', () => {
  it("get variant equals the entity response schema", () => {
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
