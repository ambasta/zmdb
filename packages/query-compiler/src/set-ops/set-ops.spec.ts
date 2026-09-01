import { describe, it, expect } from 'vitest';

import { createQueryCompiler } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { setOperation, SET_KEYWORD } from './index.js';

const qc = createQueryCompiler(postgresDialect);
const q1 = qc.selectFrom('users').where('role', '=', 'admin').compile();
const q2 = qc.selectFrom('users').where('role', '=', 'guest').compile();

describe('set operations (#120)', () => {
  it('UNION joins two selects with renumbered placeholders (pg)', () => {
    const r = setOperation('union', [q1, q2], postgresDialect);
    expect(r.text).toContain('UNION');
    expect(r.text).not.toContain('UNION ALL');
    expect(r.parameters).toEqual(['admin', 'guest']);
    // second fragment's placeholder renumbered to $2
    expect(r.text).toMatch(/\$1[\s\S]*UNION[\s\S]*\$2/);
  });

  it('UNION ALL / INTERSECT / EXCEPT keywords', () => {
    expect(setOperation('unionAll', [q1, q2], postgresDialect).text).toContain('UNION ALL');
    expect(setOperation('intersect', [q1, q2], postgresDialect).text).toContain('INTERSECT');
    expect(setOperation('except', [q1, q2], postgresDialect).text).toContain('EXCEPT');
  });

  it('SET_KEYWORD is the whole set of operators, and each one is what gets emitted', () => {
    // The map is exported, so it is the published answer to "which operators are there" —
    // the four `SetOp`s and nothing else. Asserting the keys as well as the values is what
    // makes a fifth operator added to the type show up here rather than in a caller's SQL.
    expect(Object.keys(SET_KEYWORD)).toEqual(['union', 'unionAll', 'intersect', 'except']);
    for (const [op, keyword] of Object.entries(SET_KEYWORD)) {
      const r = setOperation(op as keyof typeof SET_KEYWORD, [q1, q2], postgresDialect);
      expect(r.text).toContain(` ${keyword} `);
    }
  });

  it('single query ⇒ passthrough', () => {
    expect(setOperation('union', [q1], postgresDialect)).toEqual(q1);
  });

  it('empty ⇒ throws', () => {
    expect(() => setOperation('union', [], postgresDialect)).toThrow();
  });

  it('renumbers parameter placeholders across multiple queries using numeric offsets', () => {
    const qA = qc.selectFrom('users').where('id', '=', 10).andWhere('age', '>', 20).compile();
    const qB = qc.selectFrom('users').where('id', '=', 30).compile();
    const qC = qc.selectFrom('users').where('id', '=', 40).andWhere('status', '=', 'active').compile();

    const res = setOperation('union', [qA, qB, qC], 'postgres');
    expect(res.text).toBe(
      'SELECT * FROM "users" WHERE "id" = $1 AND "age" > $2 UNION SELECT * FROM "users" WHERE "id" = $3 UNION SELECT * FROM "users" WHERE "id" = $4 AND "status" = $5',
    );
    expect(res.parameters).toEqual([10, 20, 30, 40, 'active']);
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.parameters)).toBe(true);
  });

  it('handles set operation on external CompiledQuery objects without pre-calculated segments', () => {
    const ext1 = { text: 'SELECT * FROM "t" WHERE "x" = $1', parameters: ['val1'] };
    const ext2 = { text: 'SELECT * FROM "t" WHERE "y" = $1 AND "z" = $2', parameters: ['val2', 'val3'] };

    const res = setOperation('intersect', [ext1, ext2], 'postgres');
    expect(res.text).toBe('SELECT * FROM "t" WHERE "x" = $1 INTERSECT SELECT * FROM "t" WHERE "y" = $2 AND "z" = $3');
    expect(res.parameters).toEqual(['val1', 'val2', 'val3']);
  });

  it('correctly renumbers arbitrary external queries with repeated placeholders by value', () => {
    const ext1 = { text: 'SELECT * FROM "t" WHERE "a" = $1 OR "b" = $1', parameters: ['x'] };
    const ext2 = { text: 'SELECT * FROM "t" WHERE "c" = $1', parameters: ['y'] };

    const res = setOperation('union', [ext1, ext2], 'postgres');
    expect(res.text).toBe('SELECT * FROM "t" WHERE "a" = $1 OR "b" = $1 UNION SELECT * FROM "t" WHERE "c" = $2');
    expect(res.parameters).toEqual(['x', 'y']);
  });

  it('correctly renumbers arbitrary external queries with reordered placeholders by value', () => {
    const ext1 = { text: 'SELECT * FROM "t" WHERE "a" = $2 AND "b" = $1', parameters: ['val1', 'val2'] };
    const ext2 = { text: 'SELECT * FROM "t" WHERE "c" = $1', parameters: ['val3'] };

    const res = setOperation('union', [ext1, ext2], 'postgres');
    expect(res.text).toBe('SELECT * FROM "t" WHERE "a" = $2 AND "b" = $1 UNION SELECT * FROM "t" WHERE "c" = $3');
    expect(res.parameters).toEqual(['val1', 'val2', 'val3']);
  });

  it('preserves positional placeholders for mysql/sqlite without postgres renumbering', () => {
    const qA = { text: 'SELECT * FROM `t` WHERE `a` = ?', parameters: [1] };
    const qB = { text: 'SELECT * FROM `t` WHERE `b` = ?', parameters: [2] };

    const res = setOperation('union', [qA, qB], 'mysql');
    expect(res.text).toBe('SELECT * FROM `t` WHERE `a` = ? UNION SELECT * FROM `t` WHERE `b` = ?');
    expect(res.parameters).toEqual([1, 2]);
  });
});
