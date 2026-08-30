import { describe, it, expect } from 'vitest';
import { defineSchema, serial, text, jsonEnum, sensitive } from '../index.ts';
import { toolFromSchema, lenientParse } from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
});

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
    const SensitiveSchema = defineSchema('users', {
      id: serial().primaryKey(),
      email: text().notNull(),
      apiKey: sensitive(text().notNull()),
    });
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
    const ok = lenientParse<{ n: number }>('{"n":"5"}', (v) => ({ n: Number((v as any).n) }));
    expect(ok.data).toEqual({ n: 5 });
    const bad = lenientParse('{}', () => { throw new Error('coerce fail'); });
    expect(bad.success).toBe(false);
  });
});
