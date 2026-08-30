import { describe, it, expect } from 'vitest';
import { createQueryCompiler } from '../index.ts';
import { setOperation } from './index.ts';

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

  it('single query ⇒ passthrough', () => {
    expect(setOperation('union', [q1], 'postgres')).toEqual(q1);
  });

  it('empty ⇒ throws', () => {
    expect(() => setOperation('union', [], 'postgres')).toThrow();
  });
});
