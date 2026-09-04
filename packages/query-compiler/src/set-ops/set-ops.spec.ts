import { describe, it, expect } from 'vitest';

import { createQueryCompiler } from '../index.js';
import { setOperation, SET_KEYWORD } from './index.js';

const qc = createQueryCompiler('postgres');
const q1 = qc.selectFrom('users').where('role', '=', 'admin').compile();
const q2 = qc.selectFrom('users').where('role', '=', 'guest').compile();

describe('set operations (#120)', () => {
  it('UNION joins two selects with renumbered placeholders (pg)', () => {
    const r = setOperation('union', [q1, q2], 'postgres');
    expect(r.text).toContain('UNION');
    expect(r.text).not.toContain('UNION ALL');
    expect(r.parameters).toEqual(['admin', 'guest']);
    // second fragment's placeholder renumbered to $2
    expect(r.text).toMatch(/\$1[\s\S]*UNION[\s\S]*\$2/);
  });

  it('UNION ALL / INTERSECT / EXCEPT keywords', () => {
    expect(setOperation('unionAll', [q1, q2], 'postgres').text).toContain('UNION ALL');
    expect(setOperation('intersect', [q1, q2], 'postgres').text).toContain('INTERSECT');
    expect(setOperation('except', [q1, q2], 'postgres').text).toContain('EXCEPT');
  });

  it('SET_KEYWORD is the whole set of operators, and each one is what gets emitted', () => {
    // The map is exported, so it is the published answer to "which operators are there" —
    // the four `SetOp`s and nothing else. Asserting the keys as well as the values is what
    // makes a fifth operator added to the type show up here rather than in a caller's SQL.
    expect(Object.keys(SET_KEYWORD)).toEqual(['union', 'unionAll', 'intersect', 'except']);
    for (const [op, keyword] of Object.entries(SET_KEYWORD)) {
      const r = setOperation(op as keyof typeof SET_KEYWORD, [q1, q2], 'postgres');
      expect(r.text).toContain(` ${keyword} `);
    }
  });

  it('single query ⇒ passthrough', () => {
    expect(setOperation('union', [q1], 'postgres')).toEqual(q1);
  });

  it('empty ⇒ throws', () => {
    expect(() => setOperation('union', [], 'postgres')).toThrow();
  });
});
