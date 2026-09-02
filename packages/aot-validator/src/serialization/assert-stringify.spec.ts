import { describe, it, expect } from 'vitest';

import type { TypeIR } from '../utilities/index.ts';
import { assertStringify, stringify } from './index.ts';

// #53: validated assertStringify. Tests written BEFORE implementation (TDD).

const user: TypeIR = {
  kind: 'object',
  properties: [
    {
      name: 'id',
      type: { kind: 'scalar', scalar: 'number', constraints: { minimum: 0 } },
      optional: false,
      readonly: false,
    },
    { name: 'email', type: { kind: 'scalar', scalar: 'string' }, optional: false, readonly: false },
  ],
};

describe('assertStringify', () => {
  it('serializes identically to stringify when valid', () => {
    const v = { id: 1, email: 'a@b.com' };
    expect(assertStringify(v, user)).toBe(stringify(v));
  });

  it('throws when the value is invalid', () => {
    expect(() => assertStringify({ id: -1, email: 'a@b.com' }, user)).toThrow();
  });
});
