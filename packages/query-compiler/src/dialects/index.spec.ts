import { describe, expect, it } from 'vitest';

import { UnsupportedFeatureError } from '../errors.js';
import { createQueryCompiler } from '../index.js';
import { quoteIdentifier } from '../quoting.js';
import {
  DIALECT_NAMES,
  DIALECT_SQL_TYPES,
  DIALECTS,
  TRAITS,
  dialectTraitResolutionCount,
  requireDialectFeature,
  resolveDialectRegistry,
  type DialectTraits,
} from './index.js';

describe('dialect traits', () => {
  it('resolves dialect traits once rather than per statement', () => {
    const resolutions = dialectTraitResolutionCount();
    const postgres = TRAITS.postgres;

    createQueryCompiler('postgres').selectFrom('users').where('id', '=', 1).compile();
    createQueryCompiler('mysql').insertInto('users').values({ id: 1 }).compile();
    quoteIdentifier('sqlite', 'users');

    expect(resolutions).toBe(DIALECT_NAMES.length);
    expect(dialectTraitResolutionCount()).toBe(resolutions);
    expect(TRAITS.postgres).toBe(postgres);
    expect(Object.isFrozen(TRAITS.postgres)).toBe(true);
    expect(Object.isFrozen(TRAITS.postgres.types)).toBe(true);
    expect(Object.isFrozen(TRAITS.postgres.features)).toBe(true);
    expect(TRAITS.cockroach.family).toBe('postgres');
    expect(TRAITS.singlestore.family).toBe('mysql');
  });

  it('merges inherited scalar, feature and type traits', () => {
    const definitions: Readonly<Record<(typeof DIALECT_NAMES)[number], DialectTraits>> = {
      postgres: DIALECTS.postgres,
      mysql: {
        parent: 'postgres',
        placeholder: 'positional',
        returning: 'none',
        types: { timestamp: 'DATETIME(3)' },
        features: { rowLevelSecurity: false },
      },
      sqlite: DIALECTS.sqlite,
      mssql: DIALECTS.mssql,
      cockroach: DIALECTS.cockroach,
      singlestore: DIALECTS.singlestore,
    };

    const resolved = resolveDialectRegistry(definitions);

    expect(resolved.mysql.quote).toEqual(resolved.postgres.quote);
    expect(resolved.mysql.placeholder).toBe('positional');
    expect(resolved.mysql.returning).toBe('none');
    expect(resolved.mysql.types.text).toBe('TEXT');
    expect(resolved.mysql.types.timestamp).toBe('DATETIME(3)');
    expect(resolved.mysql.features.materializedView).toBe(true);
    expect(resolved.mysql.features.rowLevelSecurity).toBe(false);
    expect(resolved.cockroach.family).toBe('postgres');
    expect(resolved.singlestore.family).toBe('postgres');
  });

  it('turns a false feature trait into a structured refusal', () => {
    let caught: unknown;
    try {
      requireDialectFeature('mysql', 'materializedView', 'materialized views');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnsupportedFeatureError);
    if (!(caught instanceof UnsupportedFeatureError)) throw new Error('expected UnsupportedFeatureError');
    expect(caught.feature).toBe('materialized views');
    expect(caught.dialect).toBe('mysql');
    expect(caught.message).toBe('materialized views is not supported on dialect "mysql"');
  });

  it('rejects a parent cycle during eager resolution', () => {
    const definitions: Readonly<Record<(typeof DIALECT_NAMES)[number], DialectTraits>> = {
      postgres: { parent: 'mysql' },
      mysql: { parent: 'postgres' },
      sqlite: DIALECTS.sqlite,
      mssql: DIALECTS.mssql,
      cockroach: DIALECTS.cockroach,
      singlestore: DIALECTS.singlestore,
    };

    expect(() => resolveDialectRegistry(definitions)).toThrow('Dialect trait parent cycle includes "postgres"');
  });

  it('resolves every abstract SQL type for every shipped dialect', () => {
    for (const dialect of DIALECT_NAMES) {
      for (const type of DIALECT_SQL_TYPES) {
        expect(TRAITS[dialect].types[type], `${dialect}: ${type}`).toBeTypeOf('string');
      }
    }
  });
});
