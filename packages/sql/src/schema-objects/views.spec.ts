// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createViewDdl, dropViewDdl, UnsupportedFeatureError } from '@zmdb/sql/schema-objects';
import { describe, it, expect } from 'vitest';

import { postgresDialect, sqliteDialect } from '../testing/official-dialects.fixture.js';

describe('views DDL (#103)', () => {
  it('creates a plain view', () => {
    expect(createViewDdl({ name: 'active_users', select: 'SELECT * FROM users WHERE active' }, postgresDialect)).toBe(
      'CREATE VIEW "active_users" AS SELECT * FROM users WHERE active',
    );
  });

  it('creates a materialized view (pg)', () => {
    expect(createViewDdl({ name: 'mv', select: 'SELECT 1', materialized: true }, postgresDialect)).toBe(
      'CREATE MATERIALIZED VIEW "mv" AS SELECT 1',
    );
  });

  it('materialized view on sqlite throws', () => {
    try {
      createViewDdl({ name: 'mv', select: 'SELECT 1', materialized: true }, sqliteDialect);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFeatureError);
      const e = err as UnsupportedFeatureError;
      expect(e.feature).toBe('materialized views');
      expect(e.dialect).toBe('sqlite');
    }
  });

  it('drops a view', () => {
    expect(dropViewDdl('v', postgresDialect)).toBe('DROP VIEW IF EXISTS "v"');
    expect(dropViewDdl('mv', postgresDialect, true)).toBe('DROP MATERIALIZED VIEW IF EXISTS "mv"');
  });
});
