import { describe, expect, it } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import { createQueryCompiler } from '../index.js';
import { quoteIdentifier } from '../quoting.js';
import {
  cockroachDialect,
  mysqlDialect,
  officialDialects,
  postgresDialect,
  singlestoreDialect,
  sqliteDialect,
} from '../testing/official-dialects.fixture.js';
import { dialectCapabilities, dialectFamily, dialectName, dialectTraits, requireDialectFeature } from './index.js';

describe('explicit dialect objects', () => {
  it('carry immutable compiler, capability and migration ownership', () => {
    for (const dialect of Object.values(officialDialects)) {
      expect(dialectName(dialect)).toBe(dialect.name);
      expect(dialectFamily(dialect)).toBe(dialect.family);
      expect(dialectTraits(dialect)).toBe(dialect.traits);
      expect(dialectCapabilities(dialect)).toBe(dialect.capabilities);
      expect(dialect.migrations.name).toBe(dialect.name);
      expect(dialect.introspector.name).toBe(dialect.name);
      expect(Object.isFrozen(dialect)).toBe(true);
      expect(Object.isFrozen(dialect.traits)).toBe(true);
      expect(Object.isFrozen(dialect.capabilities)).toBe(true);
    }
  });

  it('uses the selected object directly without resolving a generic registry', () => {
    expect(createQueryCompiler(postgresDialect).selectFrom('users').where('id', '=', 1).compile().text).toBe(
      'SELECT * FROM "users" WHERE "id" = $1',
    );
    expect(createQueryCompiler(mysqlDialect).insertInto('users').values({ id: 1 }).compile().text).toBe(
      'INSERT INTO `users` (`id`) VALUES (?)',
    );
    expect(quoteIdentifier(sqliteDialect, 'users')).toBe('"users"');
  });

  it('keeps family inheritance inside database-owned objects', () => {
    expect(cockroachDialect.family).toBe('postgres');
    expect(singlestoreDialect.family).toBe('mysql');
    expect(cockroachDialect.traits.quote).toEqual(postgresDialect.traits.quote);
    expect(singlestoreDialect.traits.quote).toEqual(mysqlDialect.traits.quote);
  });

  it('turns a false feature capability into a structured refusal', () => {
    expect(() => requireDialectFeature(mysqlDialect, 'materializedView', 'materialized views')).toThrow(
      UnsupportedFeatureError,
    );
    expect(() => requireDialectFeature(mysqlDialect, 'materializedView', 'materialized views')).toThrow(
      'materialized views is not supported on dialect "mysql"',
    );
  });
});
