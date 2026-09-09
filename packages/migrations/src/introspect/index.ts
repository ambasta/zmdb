// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Introspector, type SqlDialect } from '@zmdb/sql';

export { type IntrospectionDriver, type Introspector, type IntrospectOptions } from '@zmdb/sql';
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
