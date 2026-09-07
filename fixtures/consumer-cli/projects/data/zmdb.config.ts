import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ZmdbConfig } from '@zmdb/compiler/config/contract';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

const events = process.env.ZMDB_FIXTURE_EVENTS;
if (events !== undefined) appendFileSync(events, 'config\n');
export default {
  schema: './src/user.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  out: './migrations',
  driver() {
    const database = new DatabaseSync(process.env.ZMDB_TEST_DATABASE ?? resolve('database.sqlite'));
    const driver = sqliteDriver(database);
    Object.defineProperty(driver, Symbol.dispose, {
      value() {
        database.close();
        if (events !== undefined) appendFileSync(events, 'driver:close\n');
      },
    });
    return driver;
  },
} satisfies ZmdbConfig;
