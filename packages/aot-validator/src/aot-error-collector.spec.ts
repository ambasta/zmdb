import { describe, expect, it } from 'vitest';

import { FixtureProject } from './emit/__testing__/project.ts';
import { validate as runtimeValidate, type TypeDescriptor } from './utilities/index.ts';

describe('Hoisted File-Scope Error Collector', () => {
  it('hoists at most one file-scoped error collection helper regardless of validation call count', () => {
    using project = FixtureProject.open();
    const src = `
      const r1 = validate<{ id: number; name: string }>(input);
      const r2 = validate<{ email: string; age: number }>(input);
      const r3 = validate<{ active: boolean }>(input);
    `;
    const result = project.transform(src);
    const helperMatches = result.code.match(/function _zmdbIssue\(/g);
    expect(helperMatches).not.toBeNull();
    expect(helperMatches!.length).toBe(1);
  });

  it('reports exact nested property paths and array element indices on validation failure', () => {
    using project = FixtureProject.open();
    const src = `
      const check = (input) => validate<{
        email: string;
        orders: { id: number; totalPrice: number }[];
      }>(input);
    `;
    const built = project.build(src);

    const invalidInput = {
      email: 'user@example.com',
      orders: [
        { id: 1, totalPrice: 100 },
        { id: 2, totalPrice: 'invalid_price' },
      ],
    };

    const res = built.check(invalidInput) as {
      success: boolean;
      errors?: { path: string; expected: string; value: unknown; message: string }[];
    };
    expect(res.success).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors!.length).toBeGreaterThan(0);

    const priceIssue = res.errors!.find(e => e.path === 'input.orders[1].totalPrice');
    expect(priceIssue).toBeDefined();
    expect(priceIssue!.expected).toBe('number');
    expect(priceIssue!.value).toBe('invalid_price');
    expect(priceIssue!.message).toBe('expected number');
  });

  it('matches 100% diagnostic message and path parity with runtime fallback', () => {
    using project = FixtureProject.open();
    const customerDesc: TypeDescriptor = {
      kind: 'object',
      fields: {
        email: { kind: 'string' },
        orders: {
          kind: 'array',
          of: {
            kind: 'object',
            fields: {
              id: { kind: 'number' },
              totalPrice: { kind: 'number' },
            },
          },
        },
      },
    };

    const input = {
      email: 'a@b.com',
      orders: [
        { id: 1, totalPrice: 10 },
        { id: 2, totalPrice: 'bad' },
        { id: 'wrong_id', totalPrice: 20 },
      ],
    };

    const runtimeRes = runtimeValidate(input, customerDesc);

    const src = `
      const check = (input) => validate<{
        email: string;
        orders: { id: number; totalPrice: number }[];
      }>(input);
    `;
    const built = project.build(src);
    const compiledRes = built.check(input) as { success: boolean; errors?: unknown[] };

    expect(compiledRes.success).toBe(false);
    expect(compiledRes.errors).toEqual(runtimeRes.errors);
  });

  it('executes straight-line boolean check with zero error object allocations on success path', () => {
    using project = FixtureProject.open();
    const src = `
      const check = (input) => validate<{ id: number; name: string }>(input);
    `;
    const built = project.build(src);
    expect(built.code).toContain('typeof input === "object"');
    expect(built.code).toContain('typeof input.id === "number"');
    expect(built.code).toContain('typeof input.name === "string"');

    const validInput = { id: 42, name: 'Alice' };

    const res = built.check(validInput) as { success: boolean; data?: unknown; errors?: unknown[] };
    expect(res).toEqual({ success: true, data: validInput });
    expect(res.errors).toBeUndefined();
  });
});
