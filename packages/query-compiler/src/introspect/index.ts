import {
  isSqlDialect,
  type Dialect,
  type DialectTarget,
  type Introspector,
  type SqlDialect,
} from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
import { mysqlIntrospector } from './mysql.js';
import { postgresIntrospector } from './postgres.js';

export type { IntrospectionDriver, Introspector, IntrospectOptions } from '../dialects/index.js';

export {
  emitDeclarations,
  type EmitDeclarationsResult,
  type EmittedDeclarationFile,
  type EmitOptions,
} from './emit.js';
export { detectDrift, type DriftOptions, type DriftReport } from './drift.js';
export {
  action,
  CatalogRowError,
  deterministicForeignKeyName,
  flagField,
  integerField,
  nullableIntegerField,
  nullableTextField,
  query,
  sortByName,
  sortWarnings,
  splitSqlList,
  tableSelected,
  textField,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
  type ReferentialAction,
} from './common.js';
export { normalizeDriftSnapshot } from './drift.js';

export interface LegacyIntrospector<Name extends string = string> extends Introspector<Name> {
  readonly dialect: Name;
}

function inheritedIntrospector<Name extends string>(name: Name, source: Introspector): LegacyIntrospector<Name> {
  return {
    name,
    dialect: name,
    snapshot: (driver, options) => source.snapshot(driver, options),
    normalizeForDrift: (snapshot, role) => source.normalizeForDrift(snapshot, role),
  };
}

const LEGACY_INTROSPECTORS: Readonly<Partial<Record<Dialect, LegacyIntrospector>>> = Object.freeze({
  postgres: postgresIntrospector,
  cockroach: inheritedIntrospector('cockroach', postgresIntrospector),
  mysql: mysqlIntrospector,
  singlestore: inheritedIntrospector('singlestore', mysqlIntrospector),
});

/** Object-first catalog selection plus the temporary built-in-name compatibility path. */
export function createIntrospector<Name extends string>(dialect: SqlDialect<Name>): Introspector<Name>;
export function createIntrospector(dialect: Dialect): LegacyIntrospector<Dialect>;
export function createIntrospector(dialect: DialectTarget): Introspector;
export function createIntrospector(dialect: DialectTarget): Introspector {
  if (isSqlDialect(dialect)) return dialect.introspector;
  const introspector = LEGACY_INTROSPECTORS[dialect];
  if (introspector !== undefined) return introspector;
  if (dialect === 'sqlite') {
    throw new UnsupportedFeatureError(
      'schema introspection',
      dialect,
      'SQLite schema introspection is shipped by @zmdb/sqlite; use sqlite.introspector or sqliteIntrospector',
    );
  }
  throw new TypeError(
    `dialect "${dialect}" has no legacy introspector; pass the injected SqlDialect object from its database package`,
  );
}
