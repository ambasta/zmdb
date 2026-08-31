import type { TypeDescriptor } from '@zmdb/aot-validator/utilities';
import { describe, it, expect } from 'vitest';

import { validateResult, validateCoverage, type BenchResult } from '../results.ts';
import { zmdbAdapter, runValidationSuite } from './adapter.ts';

// #70: validation-suite adapter + runner.

const desc: TypeDescriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number', minimum: 0 },
    email: { kind: 'string' },
  },
};
const good = { id: 1, email: 'a@b.com' };
const withExcess = { id: 1, email: 'a@b.com', extra: true };

describe('zmdb validation adapter', () => {
  it('safeParse returns data for valid input', () => {
    expect(zmdbAdapter.safeParse(good, desc)).toEqual(good);
  });
  it('looseAssert allows excess keys', () => {
    expect(zmdbAdapter.looseAssert(withExcess, desc)).toBe(true);
  });
  it('strictAssert rejects excess keys', () => {
    expect(zmdbAdapter.strictAssert(withExcess, desc)).toBe(false);
  });
  it('safeParse returns null for invalid input', () => {
    expect(zmdbAdapter.safeParse({ id: -1, email: 'a' }, desc)).toBeNull();
  });
});

describe('runValidationSuite', () => {
  it('produces one ok BenchResult per case, all schema-valid, full coverage', () => {
    const results: BenchResult[] = runValidationSuite('zmdb', zmdbAdapter, desc, good, 50);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe('ok');
      expect(validateResult(r)).toEqual([]);
    }
    // No in-scope validation case is silently omitted.
    expect(validateCoverage('validation', 'zmdb', results)).toEqual([]);
  });
});
