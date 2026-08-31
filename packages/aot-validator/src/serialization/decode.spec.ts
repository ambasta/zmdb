import { describe, it, expect } from 'vitest';

import type { TypeDescriptor } from '../utilities/index.ts';
import { decode } from './index.ts';

// #54: typed parse<T> / decode path. Tests first (TDD).

const userDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number', minimum: 0 },
    email: { kind: 'string' },
  },
};

describe('decode', () => {
  it('parses valid JSON and validates into T', () => {
    const r = decode<{ id: number; email: string }>('{"id":1,"email":"a@b.com"}', userDesc);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('fails on malformed JSON', () => {
    const r = decode('{not json', userDesc);
    expect(r.success).toBe(false);
    expect(r.issues?.length).toBeGreaterThan(0);
  });

  it('fails on JSON that violates the descriptor (with exact path)', () => {
    const r = decode('{"id":-1,"email":"a@b.com"}', userDesc);
    expect(r.success).toBe(false);
    expect(r.issues?.[0]?.path).toBe('input.id');
  });
});
