import { describe, it, expect, vi } from 'vitest';

import { tags } from '../index.js';
import { coerce, validateObject, refine } from './index.js';

// RED PHASE (#45 spec freeze): advanced validation semantics.

describe('coercion', () => {
  it('coerce.number converts numeric strings', () => {
    expect(coerce.number('42')).toBe(42);
  });
});

describe('object strictness modes', () => {
  it('strict rejects excess keys with a structured issue and returns data payload', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strict');
    expect(r.success).toBe(false);
    expect(r.data).toEqual({ a: 1, extra: 2 });
    expect(r.issues.some(i => i.path.includes('extra'))).toBe(true);
  });

  it('strip accepts and drops excess keys in data payload', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'strip');
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ a: 1 });
  });

  it('passthrough keeps excess keys in data payload', () => {
    const r = validateObject({ a: 1, extra: 2 }, { a: tags.Min(0) }, 'passthrough');
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ a: 1, extra: 2 });
  });

  it('validateObject exposes legacy errors accessor with deprecation warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateObject({ totalPrice: -1 }, { totalPrice: tags.Min(0) }, 'strict');
    expect(r.errors).toEqual(r.issues);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('DeprecationWarning'));
    spy.mockRestore();
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

describe('string-source guard', () => {
  it('rejects JavaScript callers before a refine source can become a rule', () => {
    const sources = [
      "v.constructor.constructor('return process.env.HOME')()",
      "v['constructor']['constructor']('return process.env.HOME')()",
      "v.__proto__.constructor.constructor('return process.env.HOME')()",
      "v['__proto__']['constructor']['constructor']('return process.env.HOME')()",
      "v.constructor.prototype.constructor.constructor('return process.env.HOME')()",
      "v['constructor']['prototype']['constructor']['constructor']('return process.env.HOME')()",
    ];

    for (const source of sources) {
      expect(() => Reflect.apply(refine, undefined, [source, 'must be safe'])).toThrow(
        'refine() requires a function value; source strings are not supported',
      );
    }
  });
});
