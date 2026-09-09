// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type DatabaseVertical } from '@zmdb/orm';

import { mysql } from './dialect.js';
import { mysqlFamilyDriver, type MysqlDriver, type MysqlOptions, type MysqlQueryable } from './driver.js';

export { mysql } from './dialect.js';
export {
  mysqlFamilyDriver,
  type MysqlConnection,
  type MysqlDriver,
  type MysqlExecutionResult,
  type MysqlOptions,
  type MysqlParameter,
  type MysqlPool,
  type MysqlQueryable,
  type MysqlQueryResult,
  type MysqlResultHeader,
} from './driver.js';
export { mysqlFamilyIntrospector, mysqlIntrospector, mysqlSnapshot, type MysqlCatalogOverrides } from './introspect.js';
export {
  createMysqlMigrations,
  mysqlFamilyMigrations,
  type MysqlMigrationOverrides,
  type MysqlTableDdlExtension,
  type MysqlTableDdlHelpers,
} from './migrations.js';

export function mysqlDriver(client: MysqlQueryable, options?: MysqlOptions): MysqlDriver<'mysql'> {
  return mysqlFamilyDriver(mysql, client, options);
}

export const mysqlVertical: DatabaseVertical<'mysql', MysqlQueryable, MysqlOptions> = Object.freeze({
  dialect: mysql,
  driver: mysqlDriver,
});
