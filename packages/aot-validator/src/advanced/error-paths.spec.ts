import { describe, it, expect } from 'vitest';

import { validate, type TypeDescriptor } from '../utilities/index.ts';

// #50: structured error reporting with exact paths + E2E.
// Deeply-nested object with multiple failures must report EVERY failure with an
// exact path including array indices and nested keys.

const orderDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number', minimum: 0 },
    totalPrice: { kind: 'number', minimum: 0 },
  },
};

const customerDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', maxLength: 50 },
    orders: { kind: 'array', of: orderDesc },
  },
};

describe('structured error reporting (exact paths, E2E)', () => {
  it('reports every failure with an exact nested path', () => {
    const input = {
      email: 'a@b.com',
      orders: [
        { id: 1, totalPrice: 10 }, // ok
        { id: 2, totalPrice: -5 }, // totalPrice fails
        { id: -3, totalPrice: 20 }, // id fails
      ],
    };
    const r = validate(input, customerDesc);
    expect(r.success).toBe(false);
    const paths = (r.errors ?? []).map(e => e.path);
    expect(paths).toContain('input.orders[1].totalPrice');
    expect(paths).toContain('input.orders[2].id');
    // The valid entry produces no error path.
    expect(paths).not.toContain('input.orders[0].totalPrice');
  });

  it('reports a top-level field failure with its exact path', () => {
    const r = validate({ email: 'x'.repeat(100), orders: [] }, customerDesc);
    expect(r.success).toBe(false);
    expect((r.errors ?? []).map(e => e.path)).toContain('input.email');
  });

  it('each issue carries expected/value/message', () => {
    const r = validate({ email: 'a@b.com', orders: [{ id: -1, totalPrice: 5 }] }, customerDesc);
    const issue = (r.errors ?? []).find(e => e.path === 'input.orders[0].id');
    expect(issue).toBeDefined();
    expect(issue!.value).toBe(-1);
    expect(typeof issue!.expected).toBe('string');
    expect(typeof issue!.message).toBe('string');
  });
});
