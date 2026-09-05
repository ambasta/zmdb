export { sqlite } from './dialect.js';
export { sqliteDriver, type SqliteDatabase, type SqliteOptions, type SqliteStatement } from './driver.js';
export { sqliteIntrospector } from './introspector.js';
export { sqliteMigrations } from './migrations.js';

import type { DatabaseVertical } from '@zmdb/repository';

import { sqlite } from './dialect.js';
import { sqliteDriver, type SqliteDatabase, type SqliteOptions } from './driver.js';

export const sqliteVertical: DatabaseVertical<'sqlite', SqliteDatabase, SqliteOptions> = Object.freeze({
  dialect: sqlite,
  driver: sqliteDriver,
});
