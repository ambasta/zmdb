import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { PrimaryKey, Sensitive, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import { toolFromSchema, lenientParse } from './index.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
}

export interface Keyed extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  apiKey: string & Sql<'text'> & Sensitive;
}

const { User: UserSchema, Keyed: SensitiveSchema } = schemasFrom(import.meta.url, ['User', 'Keyed']);

describe('LLM function-calling harness (#159)', () => {
  it('toolFromSchema produces a tool with create-variant parameters', () => {
    const tool = toolFromSchema('createUser', UserSchema, { description: 'Create a user' });
    expect(tool.name).toBe('createUser');
    expect(tool.description).toBe('Create a user');
    expect(tool.parameters.type).toBe('object');
    // create variant omits the auto-increment id
    expect(tool.parameters.properties).not.toHaveProperty('id');
    expect(tool.parameters.properties).toHaveProperty('email');
  });

  it('toolFromSchema omits sensitive fields from parameter schemas', () => {
    const tool = toolFromSchema('createUser', SensitiveSchema);
    expect(tool.parameters.properties).not.toHaveProperty('apiKey');
    expect(tool.parameters.properties).toHaveProperty('email');
    expect(tool.parameters.required).not.toContain('apiKey');
    expect(tool.parameters.required).toContain('email');
  });

  it('lenientParse strips ```json fences and parses', () => {
    const r = lenientParse('```json\n{"email":"a@b.com"}\n```');
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ email: 'a@b.com' });
  });

  it('lenientParse returns errors on invalid JSON', () => {
    const r = lenientParse('not json');
    expect(r.success).toBe(false);
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  it('lenientParse applies coerce; a throwing coerce ⇒ failure', () => {
    const ok = lenientParse<{ n: number }>('{"n":"5"}', v => {
      const obj = v as { n: unknown };
      if (typeof obj.n !== 'string' && typeof obj.n !== 'number') throw new Error('invalid n');
      return { n: Number(obj.n) };
    });
    expect(ok.success).toBe(true);
    expect(ok.data).toEqual({ n: 5 });

    const bad = lenientParse('{}', () => {
      throw new Error('coerce fail');
    });
    expect(bad.success).toBe(false);
    expect(bad.errors).toEqual(['coerce fail']);
  });
});
