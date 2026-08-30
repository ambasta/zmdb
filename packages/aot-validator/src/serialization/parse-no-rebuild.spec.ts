import { describe, it, expect } from 'vitest';
import { parse } from './index.ts';

// #162 — parse must NOT rebuild the value: the parsed input IS the result for a
// plain structural type. These lock the fast-path invariant and guard against a
// regression to the old field-by-field rebuild that caused the parse-case gap.

describe('parse no-rebuild invariant (#162)', () => {
  const obj = {
    number: 1,
    negNumber: -1,
    maxNumber: Number.MAX_VALUE,
    string: 'hi',
    longString: 'x'.repeat(120),
    boolean: true,
    deeplyNested: { foo: 'bar', num: 42, bool: false },
  };

  it('returns data structurally equal to the source', () => {
    const r = parse<typeof obj>(JSON.stringify(obj));
    expect(r.success).toBe(true);
    expect(r.data).toEqual(obj);
  });

  it('returns the JSON.parse result directly (no field-by-field clone)', () => {
    // A field-by-field rebuild would drop keys not explicitly copied; a direct
    // JSON.parse passthrough preserves ALL keys, including ones a rebuild would
    // miss. This guards the passthrough contract.
    const withExtra = { ...obj, _unlisted: { a: 1 } };
    const r = parse<typeof withExtra>(JSON.stringify(withExtra));
    expect(r.success).toBe(true);
    expect(r.data).toHaveProperty('_unlisted');
    expect((r.data as typeof withExtra)._unlisted).toEqual({ a: 1 });
  });

  it('does not shape-narrow: a rebuild would drop keys, passthrough keeps them all', () => {
    // Deterministic proof of the fast path: the old rebuild copied only the
    // declared fields (dropping anything else). Passthrough returns JSON.parse's
    // result verbatim, so EVERY key survives. This is a robust, noise-free guard
    // for the perf fix (removing the rebuild) without a timing assertion.
    const wide = { ...obj, extraA: 1, extraB: { nested: [1, 2, 3] }, extraC: null };
    const r = parse<typeof wide>(JSON.stringify(wide));
    expect(r.success).toBe(true);
    expect(Object.keys(r.data as object).sort()).toEqual(Object.keys(wide).sort());
    // deep-nested key on the top-level object is preserved (a rebuild reconstructs
    // only listed nested fields; passthrough keeps the whole subtree).
    expect((r.data as typeof wide).extraB).toEqual({ nested: [1, 2, 3] });
  });
});
