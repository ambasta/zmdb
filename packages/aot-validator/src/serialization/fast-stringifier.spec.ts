import { defineSchema, serial, text, boolean } from '@zmdb/schema-core';
import { describe, it, expect } from 'vitest';

import { compileFastStringifier, stringify } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  active: boolean().defaultTo(true),
  password: text().sensitive(),
});

describe('compileFastStringifier', () => {
  it('serializes single entity and excludes sensitive fields', () => {
    const fastStringify = compileFastStringifier(UserSchema);
    const user = { id: 1, email: 'alice@example.com', active: true, password: 'secretpassword' };
    const result = fastStringify(user);

    expect(result).toBe('{"id":1,"email":"alice@example.com","active":true}');
    expect(result).not.toContain('password');
    expect(result).not.toContain('secretpassword');
  });

  it('serializes arrays of entities excluding sensitive fields', () => {
    const fastStringify = compileFastStringifier(UserSchema);
    const users = [
      { id: 1, email: 'alice@example.com', password: 'p1' },
      { id: 2, email: 'bob@example.com', password: 'p2' },
    ];
    const result = fastStringify(users);

    expect(result).toBe('[{"id":1,"email":"alice@example.com"},{"id":2,"email":"bob@example.com"}]');
  });

  it('falls back to standard stringification for non-schema error objects', () => {
    const fastStringify = compileFastStringifier(UserSchema);
    const errObj = { error: 'Not found' };
    expect(fastStringify(errObj)).toBe('{"error":"Not found"}');
  });

  it('falls back to standard stringification when no schema is provided', () => {
    const fastStringify = compileFastStringifier(null);
    const data = { x: 123, y: 'abc' };
    expect(fastStringify(data)).toBe(stringify(data));
  });

  it('handles raw strings by returning them directly', () => {
    const fastStringify = compileFastStringifier(UserSchema);
    const raw = '{"raw":true}';
    expect(fastStringify(raw)).toBe(raw);
  });
});
