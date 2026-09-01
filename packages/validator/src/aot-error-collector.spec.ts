import { describe, it, expect } from 'vitest';

import { transformCode } from './transformer.ts';
import { validate as runtimeValidate, type TypeDescriptor } from './utilities/index.ts';

describe('Hoisted File-Scope Error Collector', () => {
  it('hoists at most one file-scoped error collection helper regardless of validation call count', () => {
    const src = `
      const r1 = validate<{ id: number; name: string }>(input1);
      const r2 = validate<{ email: string; age: number }>(input2);
      const r3 = validate<{ active: boolean }>(input3);
    `;
    const out = transformCode(src);
    const helperMatches = out.match(/function _collectErrors/g);
    expect(helperMatches).not.toBeNull();
    expect(helperMatches!.length).toBe(1);
    expect(out).not.toContain('import');
  });

  it('reports exact nested property paths and array element indices on validation failure', () => {
    const src = `
      const check = (input) => validate<{
        email: string;
        orders: { id: number; totalPrice: number }[];
      }>(input);
    `;
    const transformed = transformCode(src);
    const fn = new Function('input', `${transformed}\nreturn check(input);`);

    const invalidInput = {
      email: 'user@example.com',
      orders: [
        { id: 1, totalPrice: 100 },
        { id: 2, totalPrice: 'invalid_price' },
      ],
    };

    const res = fn(invalidInput);
    expect(res.success).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors.length).toBeGreaterThan(0);

    const priceIssue = res.errors.find((e: { path: string }) => e.path === 'input.orders[1].totalPrice');
    expect(priceIssue).toBeDefined();
    expect(priceIssue.expected).toBe('number');
    expect(priceIssue.value).toBe('invalid_price');
    expect(priceIssue.message).toBe('expected number');
  });

  it('matches 100% diagnostic message and path parity with runtime fallback', () => {
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
    const transformed = transformCode(src);
    const fn = new Function('input', `${transformed}\nreturn check(input);`);
    const compiledRes = fn(input);

    expect(compiledRes.success).toBe(false);
    expect(compiledRes.errors).toEqual(runtimeRes.errors);
  });

  it('executes straight-line boolean check with zero error object allocations on success path', () => {
    const src = `
      const check = (input) => validate<{ id: number; name: string }>(input);
    `;
    const transformed = transformCode(src);
    expect(transformed).toContain('typeof input === "object"');
    expect(transformed).toContain('typeof input.id === "number"');
    expect(transformed).toContain('typeof input.name === "string"');

    const fn = new Function('input', `${transformed}\nreturn check(input);`);
    const validInput = { id: 42, name: 'Alice' };

    const res = fn(validInput);
    expect(res).toEqual({ success: true, data: validInput });
    expect(res.errors).toBeUndefined();
  });
});
