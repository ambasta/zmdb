import { describe, it, expect } from 'vitest';

import { createViewDdl, dropViewDdl, UnsupportedFeatureError } from './index.ts';

describe('views DDL (#103)', () => {
  it('creates a plain view', () => {
    expect(createViewDdl({ name: 'active_users', select: 'SELECT * FROM users WHERE active' }, 'postgres')).toBe(
      'CREATE VIEW "active_users" AS SELECT * FROM users WHERE active',
    );
  });

  it('creates a materialized view (pg)', () => {
    expect(createViewDdl({ name: 'mv', select: 'SELECT 1', materialized: true }, 'postgres')).toBe(
      'CREATE MATERIALIZED VIEW "mv" AS SELECT 1',
    );
  });

  it('materialized view on sqlite throws', () => {
    try {
      createViewDdl({ name: 'mv', select: 'SELECT 1', materialized: true }, 'sqlite');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFeatureError);
      const e = err as UnsupportedFeatureError;
      expect(e.feature).toBe('materialized views');
      expect(e.dialect).toBe('sqlite');
    }
  });

  it('drops a view', () => {
    expect(dropViewDdl('v', 'postgres')).toBe('DROP VIEW IF EXISTS "v"');
    expect(dropViewDdl('mv', 'postgres', true)).toBe('DROP MATERIALIZED VIEW IF EXISTS "mv"');
  });
});
