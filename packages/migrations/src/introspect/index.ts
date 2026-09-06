import { type Introspector, type SqlDialect } from '@zmdb/query-compiler';

export type { IntrospectionDriver, Introspector, IntrospectOptions } from '@zmdb/query-compiler';
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

/** Resolve the catalog reader carried by an explicitly selected database package. */
export function createIntrospector<Name extends string>(dialect: SqlDialect<Name>): Introspector<Name> {
  return dialect.introspector;
}
