import { describe, it, expect } from 'vitest';

import type { TypeDescriptor } from '../utilities/index.ts';
import { assertStringify, stringify } from './index.ts';

// #53: validated assertStringify. Tests written BEFORE implementation (TDD).

const userDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number', minimum: 0 },
    email: { kind: 'string' },
  },
};

describe('assertStringify', () => {
  it('serializes identically to stringify when valid', () => {
    const v = { id: 1, email: 'a@b.com' };
    expect(assertStringify(v, userDesc)).toBe(stringify(v));
  });

  it('throws when the value is invalid', () => {
    expect(() => assertStringify({ id: -1, email: 'a@b.com' }, userDesc)).toThrow();
  });
});
