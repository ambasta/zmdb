// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type DatabaseVertical, type TransactionalDriver } from '@zmdb/orm';
import { type Introspector, type MigrationDialect, type SqlDialect } from '@zmdb/sql';

import {
  cockroach,
  cockroachDriver,
  cockroachIntrospector,
  cockroachMigrations,
  cockroachVertical,
  type PgOptions,
  type PgQueryable,
} from './index.js';

declare const queryable: PgQueryable;
declare const options: PgOptions;

const dialect: SqlDialect<'cockroach'> = cockroach;
const introspector: Introspector<'cockroach'> = cockroachIntrospector;
const migrations: MigrationDialect<'cockroach'> = cockroachMigrations;
const driver: TransactionalDriver<'cockroach'> = cockroachDriver(queryable, options);
const vertical: DatabaseVertical<'cockroach', PgQueryable, PgOptions> = cockroachVertical;

void [dialect, introspector, migrations, driver, vertical];
