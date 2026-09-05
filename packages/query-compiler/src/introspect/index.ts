import type { Dialect, Introspector } from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
import { mysqlIntrospector } from './mysql.js';
import { postgresIntrospector } from './postgres.js';
import { sqliteIntrospector } from './sqlite.js';

export type { IntrospectionDriver, Introspector, IntrospectOptions } from '../dialects/index.js';

export {
  emitDeclarations,
  type EmitDeclarationsResult,
  type EmittedDeclarationFile,
  type EmitOptions,
} from './emit.js';
export { detectDrift, type DriftOptions, type DriftReport } from './drift.js';
export {
  CatalogRowError,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
  type ReferentialAction,
} from './common.js';

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

/** Temporary six-name adapter. Object consumers use `dialect.introspector` directly. */
export function createIntrospector(dialect: Dialect): LegacyIntrospector<Dialect> {
  switch (dialect) {
    case 'postgres':
      return postgresIntrospector;
    case 'cockroach':
      return inheritedIntrospector(dialect, postgresIntrospector);
    case 'mysql':
      return mysqlIntrospector;
    case 'singlestore':
      return inheritedIntrospector(dialect, mysqlIntrospector);
    case 'sqlite':
      return sqliteIntrospector;
    case 'mssql':
      throw new UnsupportedFeatureError(
        'schema introspection',
        dialect,
        'schema introspection is not implemented for dialect "mssql"; use a declared schema or a hand-written catalog query',
      );
  }
}
