import { describe, it, expect } from 'vitest';

import type { TypeIR } from '../utilities/index.js';
import { decode } from './index.js';

// #54: typed parse<T> / decode path. Tests first (TDD).

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

describe('decode', () => {
  it('parses valid JSON and validates into T', () => {
    const r = decode<{ id: number; email: string }>('{"id":1,"email":"a@b.com"}', user);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('fails on malformed JSON', () => {
    const r = decode('{not json', user);
    expect(r.success).toBe(false);
    expect(r.issues?.length).toBeGreaterThan(0);
  });

  it('fails on JSON that violates the descriptor (with exact path)', () => {
    const r = decode('{"id":-1,"email":"a@b.com"}', user);
    expect(r.success).toBe(false);
    expect(r.issues?.[0]?.path).toBe('input.id');
  });
});
