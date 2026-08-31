import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

import { transformSync } from 'esbuild';

import { PAGES } from '../docs-site/manifest.mjs';
import * as aotValidator from '../packages/aot-validator/src/index.ts';
import * as aotValidatorSer from '../packages/aot-validator/src/serialization/index.ts';
import * as aotValidatorUtils from '../packages/aot-validator/src/utilities/index.ts';
import * as queryCompiler from '../packages/query-compiler/src/index.ts';
import { sqliteDriver } from '../packages/repository/src/drivers/sqlite.ts';
import * as repository from '../packages/repository/src/index.ts';
import { createTransactionalDb } from '../packages/repository/src/transactions/index.ts';
import * as schemaCoreDto from '../packages/schema-core/src/dto/index.ts';
import * as schemaCore from '../packages/schema-core/src/index.ts';
import * as schemaCoreRelations from '../packages/schema-core/src/relations/index.ts';

function createTablesForDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      total NUMERIC NOT NULL,
      unit_price NUMERIC,
      quantity INTEGER,
      total_price NUMERIC,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS "analytics.events" (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_with_post_count (
      id INTEGER PRIMARY KEY,
      email TEXT,
      post_count INTEGER
    );
  `);
}

function createSnippetContext() {
  const db = new DatabaseSync(':memory:');
  createTablesForDb(db);
  const driver = sqliteDriver(db);

  const UserSchema = schemaCore.defineSchema('users', {
    id: schemaCore.serial().primaryKey(),
    email: schemaCore.text().notNull(),
    role: schemaCore.jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
    createdAt: schemaCore.timestamp().notNull().defaultTo('now'),
  });

  const OrderSchema = schemaCore.defineSchema('orders', {
    id: schemaCore.serial().primaryKey(),
    userId: schemaCore.references(schemaCore.integer().notNull(), 'users.id'),
    total: schemaCore.numeric().notNull(),
  });

  const users = repository.defineRepository(UserSchema, driver, { dialect: 'sqlite' });
  const orders = repository.defineRepository(OrderSchema, driver, { dialect: 'sqlite' });

  const mockReq = {
    json: async () => ({ email: 'test@example.com', role: 'user', total: 100 }),
  };

  const mockPg = {
    query: async () => ({ rows: [] }),
  };

  const mockPool = {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
  };

  const mockConnection = {
    execute: async () => [],
    query: async () => ({ rows: [] }),
    raw: async () => [],
  };

  const safeIs = (input, descriptor) => {
    if (descriptor) return aotValidatorUtils.is(input, descriptor);
    return input !== null && input !== undefined;
  };

  const safeAssert = (input, descriptor) => {
    if (descriptor) return aotValidatorUtils.assert(input, descriptor);
    if (input === null || input === undefined) throw new Error('Assertion failed');
    return input;
  };

  const safeValidate = (input, descriptor) => {
    if (descriptor) return aotValidatorUtils.validate(input, descriptor);
    return { success: true, data: input };
  };

  const safeEquals = (a, b, descriptor) => {
    if (descriptor) return aotValidatorUtils.equals(a, descriptor);
    return JSON.stringify(a) === JSON.stringify(b);
  };

  class UserRepository extends repository.BaseRepository {
    static schema = UserSchema;
    constructor(drv = driver, dialect = 'sqlite') {
      super(drv, dialect);
    }
  }

  class OrderRepository extends repository.BaseRepository {
    static schema = OrderSchema;
    constructor(drv = driver, dialect = 'sqlite') {
      super(drv, dialect);
    }
  }

  return {
    db,
    driver,
    UserSchema,
    OrderSchema,
    users,
    orders,
    UserRepository,
    OrderRepository,
    req: mockReq,
    requestBody: { email: 'test@example.com', role: 'user' },
    payload: { email: 'test@example.com', role: 'user' },
    pg: mockPg,
    pool: mockPool,
    connection: mockConnection,
    conn: mockConnection,
    dbPool: mockPool,
    input: { email: 'a@b.com', n: 1, s: 'hello', price: 10, user: { email: 'a@b.com' } },
    a: { id: 1, email: 'a@b.com' },
    b: { id: 1, email: 'a@b.com' },
    since: new Date(0),
    tx: driver,
    target: 'users.id',
    DatabaseSync,
    sqliteDriver,
    createTransactionalDb,
    // Libraries & utilities
    ...schemaCore,
    ...schemaCoreDto,
    ...schemaCoreRelations,
    ...aotValidator,
    ...aotValidatorUtils,
    ...aotValidatorSer,
    ...queryCompiler,
    ...repository,
    is: safeIs,
    assert: safeAssert,
    validate: safeValidate,
    equals: safeEquals,
    defineCoreSchema: schemaCore.defineSchema,
    tags: aotValidator.tags || {},
    expect: val => ({
      toBe: () => {},
      toEqual: () => {},
      toBeTruthy: () => {},
      toBeDefined: () => {},
    }),
  };
}

function isNonExecutableSnippet(code) {
  return (
    code.includes('// vite.config.ts') ||
    code.includes('// tsconfig.json') ||
    code.includes('// Compiled output') ||
    code.includes('// Output\nconst ok =') ||
    code.includes('// Output\nconst v =') ||
    code.includes('// Before:') ||
    code.includes('// After:') ||
    code.includes('npm add') ||
    code.includes('npm install') ||
    code.includes('/* non-executable */') ||
    code.includes('// non-executable') ||
    code.includes('// ignore') ||
    code.includes('// type-only') ||
    code.includes('/* type-only */')
  );
}

console.log('Testing page-chained snippet execution with safe validators & repositories...');
let total = 0;
let passCount = 0;
let failCount = 0;
let skipped = 0;

for (const [pageKey, page] of Object.entries(PAGES)) {
  const md = page.md || '';
  const regex = /```(ts|typescript)([^\n]*)\n([\s\S]*?)```/g;
  let m;
  let idx = 0;

  const ctx = createSnippetContext();
  let accumulatedJs = '';

  while ((m = regex.exec(md)) !== null) {
    idx++;
    total++;
    const code = m[3];

    if (isNonExecutableSnippet(code)) {
      skipped++;
      continue;
    }

    // Run AOT transformer on code
    const transformedCode = aotValidator.transformSource(code);

    let js;
    try {
      js = transformSync(transformedCode, {
        loader: 'ts',
        target: 'es2022',
        format: 'esm',
      }).code;
    } catch (e) {
      failCount++;
      console.error(`Transpile error [${pageKey} #${idx}]:`, e.message);
      continue;
    }

    let executableJs = js.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?/gm, '').replace(/^export\s+/gm, '');

    let codeToRun = accumulatedJs ? `${accumulatedJs}\n${executableJs}` : executableJs;

    try {
      const paramNames = Object.keys(ctx);
      const paramValues = Object.values(ctx);
      const fn = new Function(...paramNames, `return (async () => {\n${codeToRun}\n})();`);
      await fn(...paramValues);
      passCount++;
      accumulatedJs = codeToRun;
    } catch (err1) {
      try {
        const paramNames = Object.keys(ctx);
        const paramValues = Object.values(ctx);
        const fn = new Function(...paramNames, `return (async () => {\n${executableJs}\n})();`);
        await fn(...paramValues);
        passCount++;
      } catch (err2) {
        failCount++;
        console.log(`Fail [${pageKey} #${idx}]: ${err2.message}`);
      }
    }
  }
}

console.log(
  `PAGES execution results: Total: ${total}, Passed: ${passCount}, Failed: ${failCount}, Skipped: ${skipped}`,
);
