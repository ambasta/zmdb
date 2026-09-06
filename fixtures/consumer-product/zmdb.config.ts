import { DatabaseSync } from 'node:sqlite';

import { defineConfig } from 'zmdb';
import { sqlite, sqliteDriver } from 'zmdb/sqlite';

const databasePath = process.env.ZMDB_PRODUCT_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_PRODUCT_DATABASE is required');

export default defineConfig({
  schema: 'src/schema.ts',
  dialect: sqlite,
  project: './tsconfig.consumer.json',
  out: './migrations',
  driver: () => sqliteDriver(new DatabaseSync(databasePath)),
});
