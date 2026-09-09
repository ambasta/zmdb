import { type TypeIR } from '@zmdb/validator';
import { decode } from '@zmdb/validator/serialization';
import { describe, it, expect } from 'vitest';

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
    expect(Object.keys(r).toSorted()).toEqual(['data', 'success']);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('fails on malformed JSON', () => {
    const r = decode('{not json', user);
    expect(Object.keys(r).toSorted()).toEqual(['issues', 'success']);
    expect(r.success).toBe(false);
    expect(!r.success && r.issues.length).toBeGreaterThan(0);
  });

  it('fails on JSON that violates the descriptor (with exact path)', () => {
    const r = decode('{"id":-1,"email":"a@b.com"}', user);
    expect(Object.keys(r).toSorted()).toEqual(['issues', 'success']);
    expect(r.success).toBe(false);
    expect(!r.success && r.issues[0]?.path).toBe('input.id');
  });
});

it('decode retains a useful diagnostic when validation cannot run', () => {
  expect(decode('{}')).toEqual({
    success: false,
    issues: [{ path: 'input', message: expect.stringContaining('runtime type witness required') }],
  });
});
