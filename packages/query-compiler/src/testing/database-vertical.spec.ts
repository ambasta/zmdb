import { readFile } from 'node:fs/promises';

import { ddlType, emitUp } from '@zmdb/migrations';
import { detectDrift } from '@zmdb/migrations/introspect';
import { driverMigrationConnection } from '@zmdb/migrations/runner';
import type { ColumnSnapshot } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

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

describe('database vertical conformance (#668)', () => {
  it('compiles with a synthetic external dialect', () => {
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
    const exportsBefore = Object.keys(dialectApi).toSorted();

    const fixture = await import('./external-dialect.fixture.js');

    expect(fixture.externalDialect.name).toBe('acme');
    expect(Object.keys(dialectApi).toSorted()).toEqual(exportsBefore);
    expect(Reflect.get(dialectApi, 'DIALECT_NAMES')).toBeUndefined();
    expect(Reflect.get(dialectApi, 'DIALECTS')).toBeUndefined();
    expect(Reflect.get(dialectApi, 'registerDialect')).toBeUndefined();
  });

  it('loads no official database package from query-compiler', async () => {
    const manifest: { readonly dependencies?: Readonly<Record<string, string>> } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const dependencies = Object.keys(manifest.dependencies ?? {});

    expect(
      dependencies.filter(name => /^@zmdb\/(sqlite|postgres|mysql|mssql|cockroach|singlestore)$/.test(name)),
    ).toEqual([]);
  });

  it('requires every SQL type and statement capability', () => {
    const dialect = makeSyntheticDialect();

    assertDialectConformance(dialect);
    expect(Object.keys(dialect.traits.types).toSorted()).toEqual([...SQL_TYPE_KEYS].toSorted());
    expect(Object.keys(dialect.traits.returning).toSorted()).toEqual(['delete', 'insert', 'update', 'upsert']);
    expect(Object.keys(dialect.capabilities.returning).toSorted()).toEqual(['delete', 'insert', 'update', 'upsert']);
  });

  it('requires a migration implementation and introspector', () => {
    const dialect = makeSyntheticDialect();
    const defineSqlDialect = exportedFunction(dialectApi, 'defineSqlDialect');
    const defined = objectValue(defineSqlDialect(dialect), 'defined dialect');

    expect(Reflect.get(defined, 'migrations')).toBe(dialect.migrations);
    expect(Reflect.get(defined, 'introspector')).toBe(dialect.introspector);
  });

  it('emits migrations through an injected migration dialect', async () => {
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
    expect(emitUp({ kind: 'drop_table', table: 'widgets' }, dialect)).toBe('ACME UP drop_table');

    const queries: string[] = [];
    const connection = driverMigrationConnection(
      {
        dialect,
        execute: query => {
          queries.push(query.text);
          return Promise.resolve([]);
        },
      },
      dialect,
    );
    await connection.ensureVersionTable?.();
    expect(queries).toEqual(['CREATE TABLE IF NOT EXISTS <_zmdb_migrations> (<version> INTEGER)']);
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
    expect(detectDrift(normalized, emptySchemaSnapshot(), { dialect })).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });

  it('resolves inherited traits once', () => {
    const parent = makeSyntheticDialect();
    const parentTypes = parent.traits.types;
    const parentSerial = parentTypes.serial;
    const childParts = makeSyntheticDialect();
    let traitReads = 0;
    const extension: FrozenSqlDialectExtension<'acme-cloud'> = {
      name: 'acme-cloud',
      traits: {
        types: { serial: 'CLOUD SERIAL' },
        get paramLimit() {
          traitReads++;
          return 321;
        },
      },
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
    expect(traitReads).toBe(1);

    const compiler = externalCompiler(child as FrozenSqlDialect);
    for (const id of [1, 2, 3]) {
      const selectFrom = Reflect.get(compiler, 'selectFrom');
      if (typeof selectFrom !== 'function') throw new TypeError('compiler has no selectFrom');
      const select = objectValue(Reflect.apply(selectFrom, compiler, ['widgets']), 'select builder');
      const where = Reflect.get(select, 'where');
      if (typeof where !== 'function') throw new TypeError('select builder has no where');
      const filtered = objectValue(Reflect.apply(where, select, ['id', '=', id]), 'filtered select builder');
      const compile = Reflect.get(filtered, 'compile');
      if (typeof compile !== 'function') throw new TypeError('select builder has no compile');
      compiledQuery(Reflect.apply(compile, filtered, []));
    }
    expect(traitReads).toBe(1);
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
