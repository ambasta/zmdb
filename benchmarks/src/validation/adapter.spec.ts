import { defineSchema, integer, serial, text } from '@zmdb/schema-core';
import { irFromSchema, objectTypeFromIR } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { validateResult, validateCoverage, type BenchResult } from '../results.ts';
import { zmdbAdapter, runValidationSuite } from './adapter.ts';

// #70: validation-suite adapter + runner.
//
// The witness is derived from a schema rather than written out here: the point of the
// suite is that a user declares the shape once, and a test that hand-writes it is testing
// a path no user takes (REQ-TF-9).
const Accounts = defineSchema('accounts', {
  id: serial().primaryKey(),
  count: integer().validate({ kind: 'minimum', value: 0 }),
  email: text(),
});
const type = objectTypeFromIR(irFromSchema(Accounts), 'entity');
const good = { id: 1, count: 1, email: 'a@b.com' };
const withExcess = { ...good, extra: true };

describe('zmdb validation adapter', () => {
  it('safeParse returns data for valid input', () => {
    expect(zmdbAdapter.safeParse(good, type)).toEqual(good);
  });
  it('looseAssert allows excess keys', () => {
    expect(zmdbAdapter.looseAssert(withExcess, type)).toBe(true);
  });
  it('strictAssert rejects excess keys', () => {
    expect(zmdbAdapter.strictAssert(withExcess, type)).toBe(false);
  });
  it('safeParse returns null for invalid input', () => {
    expect(zmdbAdapter.safeParse({ ...good, count: -1 }, type)).toBeNull();
  });
});

describe('runValidationSuite', () => {
  it('produces one ok BenchResult per case, all schema-valid, full coverage', () => {
    const results: BenchResult[] = runValidationSuite('zmdb', zmdbAdapter, type, good, 50);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe('ok');
      expect(validateResult(r)).toEqual([]);
    }
    // No in-scope validation case is silently omitted.
    expect(validateCoverage('validation', 'zmdb', results)).toEqual([]);
  });
});
