import { createSchemaDdl, qualify } from '@zmdb/sql/schema-objects';
import { describe, it, expect } from 'vitest';

import { mysqlDialect, postgresDialect } from '../testing/official-dialects.fixture.js';

describe('schemas / namespaces DDL (#112)', () => {
  it('creates a schema', () => {
    expect(createSchemaDdl('analytics', postgresDialect)).toBe('CREATE SCHEMA "analytics"');
  });
  it('qualifies an object with its schema', () => {
    expect(qualify('analytics', 'events', postgresDialect)).toBe('"analytics"."events"');
    expect(qualify('app', 'users', mysqlDialect)).toBe('`app`.`users`');
  });
});
