// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export { sqlite } from './dialect.js';
export { sqliteDriver, type SqliteDatabase, type SqliteOptions, type SqliteStatement } from './driver.js';
export { sqliteIntrospector } from './introspector.js';
export { sqliteMigrations } from './migrations.js';

import { type DatabaseVertical } from '@zmdb/orm';

import { sqlite } from './dialect.js';
import { sqliteDriver, type SqliteDatabase, type SqliteOptions } from './driver.js';

export const sqliteVertical: DatabaseVertical<'sqlite', SqliteDatabase, SqliteOptions> = Object.freeze({
  dialect: sqlite,
  driver: sqliteDriver,
});
