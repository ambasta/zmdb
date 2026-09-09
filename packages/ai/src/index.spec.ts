import { schemasFrom } from '@zmdb/compiler/testing';
import { type PrimaryKey, type Sensitive, type Serial, type Sql, type Table } from '@zmdb/schema/tags';
import { AssertError } from '@zmdb/validator';
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
    expect(r.success && r.data).toEqual({ email: 'a@b.com' });
  });

  it('lenientParse returns issues on invalid JSON', () => {
    const r = lenientParse('not json');
    expect(r.success).toBe(false);
    expect(r).toEqual({
      success: false,
      issues: [{ path: 'input', expected: 'valid JSON', value: 'not json', message: expect.any(String) }],
    });
  });

  it('lenientParse applies coerce; a throwing coerce ⇒ failure', () => {
    const ok = lenientParse<{ n: number }>('{"n":"5"}', v => ({ n: Number((v as { n: unknown }).n) }));
    expect(ok.success && ok.data).toEqual({ n: 5 });
    const bad = lenientParse('{}', () => {
      throw new Error('coerce fail');
    });
    expect(bad).toEqual({ success: false, issues: [{ path: 'input', message: 'coerce fail' }] });
  });
});

it('lenientParse preserves callback data identity and assertion issue details', () => {
  const data = { n: 1 };
  const success = lenientParse('{}', () => data);
  expect(success).toEqual({ success: true, data });
  if (!success.success) throw new Error('Expected successful coercion');
  expect(success.data).toBe(data);
  const issues = [{ path: 'input.n', expected: 'number', value: 'bad', message: 'expected number' }];
  const failure = lenientParse('{}', () => {
    throw new AssertError('expected number', issues);
  });
  expect(failure).toEqual({ success: false, issues });
  if (failure.success) throw new Error('Expected failed coercion');
  expect(Reflect.get(failure, 'issues')).toBe(issues);
});
