import { describe, expect, it } from 'vitest';

import { detectDrift } from '../introspect/index.js';
import type { ColumnSnapshot } from '../migrations/index.js';
import { ddlType } from '../migrations/index.js';
import {
  DATABASE_CAPABILITY_MATRIX,
  DATABASE_CAPABILITY_KEYS,
  OFFICIAL_DATABASES,
  SQL_TYPE_KEYS,
  VERTICAL_CONTRACT_KEYS,
} from './capability-matrix.js';
import {
  assertCapabilityMatrix,
  assertDialectConformance,
  capabilityMatrixProblems,
  emptySchemaSnapshot,
  makeSyntheticDialect,
  type FrozenIntrospector,
  type FrozenMigrationDialect,
  type FrozenSqlDialect,
  type FrozenSqlDialectExtension,
} from './database-vertical.js';

const queryApi: object = await import('../index.js');
const dialectApi: object = await import('../dialects/index.js');

function exportedFunction(api: object, name: string): (...args: unknown[]) => unknown {
  const value: unknown = Reflect.get(api, name);
  expect(value, `${name} export`).toBeTypeOf('function');
  if (typeof value !== 'function') throw new TypeError(`${name} is not exported`);
  return (...args: unknown[]) => Reflect.apply(value, undefined, args);
}

function objectValue(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} is not an object`);
  }
  return value;
}

function compiledQuery(value: unknown): { readonly text: string; readonly parameters: readonly unknown[] } {
  const candidate = objectValue(value, 'compiled query');
  const text: unknown = Reflect.get(candidate, 'text');
  const parameters: unknown = Reflect.get(candidate, 'parameters');
  if (typeof text !== 'string' || !Array.isArray(parameters)) {
    throw new TypeError('expected a CompiledQuery');
  }
  return {
    text,
    parameters,
  };
}

function externalCompiler(dialect: FrozenSqlDialect): object {
  return objectValue(exportedFunction(queryApi, 'createQueryCompiler')(dialect), 'compiler');
}

function childMigrationDialect<Name extends string>(
  source: FrozenMigrationDialect,
  name: Name,
): FrozenMigrationDialect<Name> {
  return Object.freeze({
    ...source,
    name,
    connection: () => {
      throw new Error('the family immutability test does not open a connection');
    },
  });
}

function childIntrospector<Name extends string>(source: FrozenIntrospector, name: Name): FrozenIntrospector<Name> {
  return Object.freeze({ ...source, name });
}

describe('database vertical conformance (#667)', () => {
  // Current measured behavior: the object reaches TRAITS as a property key and compilation
  // throws `TypeError: Cannot read properties of undefined (reading 'quote')`.
  it.fails('accepts a third-party dialect without editing a generic package', () => {
    const dialect = makeSyntheticDialect();
    const compiler = externalCompiler(dialect);
    const selectFrom: unknown = Reflect.get(compiler, 'selectFrom');
    if (typeof selectFrom !== 'function') throw new TypeError('compiler has no selectFrom');
    const select = objectValue(Reflect.apply(selectFrom, compiler, ['widgets']), 'select builder');
    const where: unknown = Reflect.get(select, 'where');
    if (typeof where !== 'function') throw new TypeError('select builder has no where');
    const filtered = objectValue(Reflect.apply(where, select, ['id', '=', 7]), 'filtered select builder');
    const compile: unknown = Reflect.get(filtered, 'compile');
    if (typeof compile !== 'function') throw new TypeError('select builder has no compile');

    expect(compiledQuery(Reflect.apply(compile, filtered, []))).toEqual({
      text: 'SELECT * FROM <widgets> WHERE <id> = $1',
      parameters: [7],
    });
  });

  it('does not register a dialect as an import side effect', async () => {
    const namesBefore = [...Reflect.get(dialectApi, 'DIALECT_NAMES')];
    const registryBefore = Reflect.get(dialectApi, 'DIALECTS');
    const resolutionsBefore = exportedFunction(dialectApi, 'dialectTraitResolutionCount')();

    const fixture = await import('./external-dialect.fixture.js');

    expect(fixture.externalDialect.name).toBe('acme');
    expect(Reflect.get(dialectApi, 'DIALECT_NAMES')).toEqual(namesBefore);
    expect(Reflect.get(dialectApi, 'DIALECTS')).toBe(registryBefore);
    expect(exportedFunction(dialectApi, 'dialectTraitResolutionCount')()).toBe(resolutionsBefore);
    expect(Reflect.get(dialectApi, 'registerDialect')).toBeUndefined();
  });

  it('requires every SQL type and statement capability', () => {
    const dialect = makeSyntheticDialect();

    assertDialectConformance(dialect);
    expect(Object.keys(dialect.traits.types).toSorted()).toEqual([...SQL_TYPE_KEYS].toSorted());
    expect(Object.keys(dialect.traits.returning).toSorted()).toEqual(['delete', 'insert', 'update', 'upsert']);
    expect(Object.keys(dialect.capabilities.returning).toSorted()).toEqual(['delete', 'insert', 'update', 'upsert']);
  });

  // Current measured behavior: `defineSqlDialect` is not exported.
  it.fails('requires a migration implementation and introspector', () => {
    const dialect = makeSyntheticDialect();
    const defineSqlDialect = exportedFunction(dialectApi, 'defineSqlDialect');
    const defined = objectValue(defineSqlDialect(dialect), 'defined dialect');

    expect(Reflect.get(defined, 'migrations')).toBe(dialect.migrations);
    expect(Reflect.get(defined, 'introspector')).toBe(dialect.introspector);
  });

  // Current measured behavior: ddlType treats the injected object as a registry key and throws
  // `TypeError: Cannot read properties of undefined (reading 'types')`.
  it.fails('runs migration emission through the selected external dialect', () => {
    const dialect = makeSyntheticDialect();
    const column: ColumnSnapshot = {
      name: 'id',
      type: 'integer',
      nullable: false,
      primaryKey: true,
    };
    const injectedDdlType = ddlType as unknown as (
      migrations: FrozenMigrationDialect,
      column: ColumnSnapshot,
    ) => string;

    expect(injectedDdlType(dialect.migrations, column)).toBe('INTEGER');
  });

  it('runs an external introspector through generic drift detection', async () => {
    const dialect = makeSyntheticDialect();
    const queries: string[] = [];
    const catalog = await dialect.introspector.snapshot({
      execute: query => {
        queries.push(query.text);
        return Promise.resolve([]);
      },
    });
    const normalized = dialect.introspector.normalizeForDrift(catalog, 'live');

    expect(queries).toEqual(['SELECT * FROM <acme_catalog>']);
    expect(detectDrift(normalized, emptySchemaSnapshot())).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });

  // Current measured behavior: `extendSqlDialect` is not exported.
  it.fails('a family extension cannot mutate its parent traits', () => {
    const parent = makeSyntheticDialect();
    const parentTypes = parent.traits.types;
    const parentSerial = parentTypes.serial;
    const childParts = makeSyntheticDialect();
    const extension: FrozenSqlDialectExtension<'acme-cloud'> = {
      name: 'acme-cloud',
      traits: { types: { serial: 'CLOUD SERIAL' } },
      migrations: childMigrationDialect(childParts.migrations, 'acme-cloud'),
      introspector: childIntrospector(childParts.introspector, 'acme-cloud'),
    };
    const extendSqlDialect = exportedFunction(dialectApi, 'extendSqlDialect');
    const child = objectValue(extendSqlDialect(parent, extension), 'extended dialect');
    const childTraits = objectValue(Reflect.get(child, 'traits'), 'extended traits');
    const childTypes = objectValue(Reflect.get(childTraits, 'types'), 'extended type map');

    expect(parent.traits.types).toBe(parentTypes);
    expect(parent.traits.types.serial).toBe(parentSerial);
    expect(Reflect.get(child, 'family')).toBe(parent.family);
    expect(Reflect.get(childTypes, 'serial')).toBe('CLOUD SERIAL');
    expect(Object.isFrozen(childTraits)).toBe(true);
    expect(Object.isFrozen(childTypes)).toBe(true);
  });

  it('adding a capability requires an expectation or refusal from every database', () => {
    assertCapabilityMatrix(DATABASE_CAPABILITY_MATRIX);
    expect(Object.keys(DATABASE_CAPABILITY_MATRIX).toSorted()).toEqual([...OFFICIAL_DATABASES].toSorted());

    for (const database of OFFICIAL_DATABASES) {
      const row = DATABASE_CAPABILITY_MATRIX[database];
      expect(Object.keys(row.capabilities).toSorted(), database).toEqual([...DATABASE_CAPABILITY_KEYS].toSorted());
      expect(Object.keys(row.sqlTypes).toSorted(), database).toEqual([...SQL_TYPE_KEYS].toSorted());
      expect(Object.keys(row.verticals).toSorted(), database).toEqual([...VERTICAL_CONTRACT_KEYS].toSorted());
    }

    const incomplete = objectValue(structuredClone(DATABASE_CAPABILITY_MATRIX), 'cloned capability matrix');
    const sqlite = objectValue(Reflect.get(incomplete, 'sqlite'), 'cloned SQLite row');
    const capabilities = objectValue(Reflect.get(sqlite, 'capabilities'), 'cloned SQLite capabilities');
    Reflect.deleteProperty(capabilities, 'cancellation');
    expect(capabilityMatrixProblems(incomplete)).toContain(
      `sqlite.capabilities keys are ${DATABASE_CAPABILITY_KEYS.filter(key => key !== 'cancellation')
        .toSorted()
        .join(', ')}; expected ${[...DATABASE_CAPABILITY_KEYS].toSorted().join(', ')}`,
    );
  });
});
