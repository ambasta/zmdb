import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { sqlite } from '@zmdb/sqlite';

const databasePath = process.env.ZMDB_TEST_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_TEST_DATABASE is required');

function sqliteValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`cannot bind ${typeof value} to sqlite`);
}

export default {
  schema: 'src/**/*.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  out: './migrations',
  driver: () => {
    const database = new DatabaseSync(databasePath);
    const driver = {
      dialect: sqlite,
      async execute(query: { readonly text: string; readonly parameters: readonly unknown[] }) {
        const read = /^\s*(?:PRAGMA|SELECT|WITH)\b/i.test(query.text) || /\bRETURNING\b/i.test(query.text);
        const parameters = query.parameters.map(sqliteValue);
        if (!read && query.parameters.length === 0) {
          database.exec(query.text);
          return [];
        }
        const statement = database.prepare(query.text);
        return read ? statement.all(...parameters) : (statement.run(...parameters), []);
      },
    };
    return {
      ...driver,
      async transaction<Result>(run: (transaction: typeof driver) => Promise<Result>): Promise<Result> {
        database.exec('BEGIN');
        try {
          const result = await run(driver);
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    };
  },
};
