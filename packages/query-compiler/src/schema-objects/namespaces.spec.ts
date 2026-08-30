import { describe, it, expect } from 'vitest';

import { createSchemaDdl, qualify } from './index.ts';

describe('schemas / namespaces DDL (#112)', () => {
  it('creates a schema', () => {
    expect(createSchemaDdl('analytics', 'postgres')).toBe('CREATE SCHEMA "analytics"');
  });
  it('qualifies an object with its schema', () => {
    expect(qualify('analytics', 'events', 'postgres')).toBe('"analytics"."events"');
    expect(qualify('app', 'users', 'mysql')).toBe('`app`.`users`');
  });
});
