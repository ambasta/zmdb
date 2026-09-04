import { describe, it, expect } from 'vitest';

import { tags } from '../index.js';
import { coerce, validateObject, refine } from './index.js';

// RED PHASE (#45 spec freeze): advanced validation semantics.

describe('coercion', () => {
  it('coerce.number converts numeric strings', () => {
    expect(coerce.number('42')).toBe(42);
  });
});

describe('object strictness modes', () => {
  it('strict rejects excess keys with a structured issue', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strict');
    expect(r.success).toBe(false);
    expect(r.issues.some(i => i.path.includes('extra'))).toBe(true);
  });

  it('strip accepts and drops excess keys', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strip');
    expect(r.success).toBe(true);
  });
});

describe('structured error paths', () => {
  it('reports exact nested path', () => {
    const rule = refine(v => typeof v === 'number' && v >= 0, 'must be >= 0');
    const r = validateObject({ totalPrice: -1 }, { totalPrice: rule }, 'strict');
    expect(r.success).toBe(false);
    expect(r.issues[0]?.path).toBe('input.totalPrice');
    expect(r.issues[0]?.message).toBe('must be >= 0');
  });
});
