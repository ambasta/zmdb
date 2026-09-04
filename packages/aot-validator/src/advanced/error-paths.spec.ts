import { describe, it, expect } from 'vitest';

import { validate, type TypeIR } from '../utilities/index.js';

// #50: structured error reporting with exact paths + E2E.
// Deeply-nested object with multiple failures must report EVERY failure with an
// exact path including array indices and nested keys.

/** `Min<0>` on both columns, as the reflection would emit it. */
const nonNegative: TypeIR = { kind: 'scalar', scalar: 'number', constraints: { minimum: 0 } };

const order: TypeIR = {
  kind: 'object',
  properties: [
    { name: 'id', type: nonNegative, optional: false, readonly: false },
    { name: 'totalPrice', type: nonNegative, optional: false, readonly: false },
  ],
};

const customer: TypeIR = {
  kind: 'object',
  properties: [
    {
      name: 'email',
      type: { kind: 'scalar', scalar: 'string', constraints: { maxLength: 50 } },
      optional: false,
      readonly: false,
    },
    { name: 'orders', type: { kind: 'array', element: order }, optional: false, readonly: false },
  ],
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
    const r = validate(input, customer);
    expect(r.success).toBe(false);
    const paths = (r.errors ?? []).map(e => e.path);
    expect(paths).toContain('input.orders[1].totalPrice');
    expect(paths).toContain('input.orders[2].id');
    // The valid entry produces no error path.
    expect(paths).not.toContain('input.orders[0].totalPrice');
  });

  it('reports a top-level field failure with its exact path', () => {
    const r = validate({ email: 'x'.repeat(100), orders: [] }, customer);
    expect(r.success).toBe(false);
    expect((r.errors ?? []).map(e => e.path)).toContain('input.email');
  });

  it('each issue carries expected/value/message', () => {
    const r = validate({ email: 'a@b.com', orders: [{ id: -1, totalPrice: 5 }] }, customer);
    const issue = (r.errors ?? []).find(e => e.path === 'input.orders[0].id');
    expect(issue).toBeDefined();
    expect(issue!.value).toBe(-1);
    expect(typeof issue!.expected).toBe('string');
    expect(typeof issue!.message).toBe('string');
  });
});
