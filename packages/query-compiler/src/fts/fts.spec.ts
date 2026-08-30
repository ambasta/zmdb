import { describe, it, expect } from 'vitest';

import { ftsSelectFrom, UnsupportedFeatureError } from './index.ts';

// RED PHASE (#94 spec freeze): FTS predicate golden SQL + per-dialect DNF.

describe('full-text search compilation', () => {
  it('postgres to_tsvector/@@/to_tsquery (parameterized)', () => {
    const q = ftsSelectFrom('customers', 'postgres').whereMatch('company_name', 'ltd').compile();
    expect(q.text).toBe(
      `SELECT * FROM "customers" WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)`,
    );
    expect(q.parameters).toEqual(['ltd']);
  });

  it('mysql MATCH ... AGAINST', () => {
    const q = ftsSelectFrom('customers', 'mysql').whereMatch('company_name', 'ltd').compile();
    expect(q.text).toBe('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(? IN NATURAL LANGUAGE MODE)');
  });

  it('sqlite is an honest DNF (throws UnsupportedFeatureError)', () => {
    try {
      ftsSelectFrom('customers', 'sqlite').whereMatch('company_name', 'ltd');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFeatureError);
      const e = err as UnsupportedFeatureError;
      expect(e.feature).toBe('full-text search');
      expect(e.dialect).toBe('sqlite');
    }
  });
});
