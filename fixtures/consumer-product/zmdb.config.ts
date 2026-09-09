import { DatabaseSync } from 'node:sqlite';

import { defineConfig } from '@zmdb/core';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';

const databasePath = process.env.ZMDB_PRODUCT_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_PRODUCT_DATABASE is required');

export default defineConfig({
  schema: 'src/schema.ts',
  dialect: sqlite,
  project: './tsconfig.consumer.json',
  out: './migrations',
  driver: () => {
    const database = new DatabaseSync(databasePath);
    return Object.assign(sqliteDriver(database), { [Symbol.dispose]: () => database.close() });
  },
});
