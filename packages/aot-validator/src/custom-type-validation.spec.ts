import type { TypeIR } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { is, assert, validate, AssertError } from './utilities/index.js';

describe('Date Scalar & Custom Type Verification', () => {
  const schemaIR: TypeIR = {
    kind: 'object',
    properties: [
      {
        name: 'createdAt',
        optional: false,
        readonly: false,
        type: { kind: 'scalar', scalar: 'date' },
      },
    ],
  };

  it('validates date instances dynamically without throwing on valid inputs', () => {
    const validData = { createdAt: new Date('2026-01-01T00:00:00.000Z') };

    expect(is(validData, schemaIR)).toBe(true);

    const result = validate(validData, schemaIR);
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();

    expect(assert(validData, schemaIR)).toBe(validData);
  });

  it('safely catches invalid date inputs and reports validation failure without crashing', () => {
    const invalidData = { createdAt: 'not-a-date-object' };

    expect(is(invalidData, schemaIR)).toBe(false);

    const result = validate(invalidData, schemaIR);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]?.path).toBe('input.createdAt');

    expect(() => assert(invalidData, schemaIR)).toThrow(AssertError);
  });
});
