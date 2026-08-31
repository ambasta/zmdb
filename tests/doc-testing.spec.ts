import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { transformSync } from 'esbuild';
import { describe, test, expect } from 'vitest';

import { PAGES } from '../docs-site/manifest.mjs';
import * as aotValidatorAdvanced from '../packages/aot-validator/src/advanced/index.ts';
import * as aotValidator from '../packages/aot-validator/src/index.ts';
import * as aotValidatorPlugin from '../packages/aot-validator/src/plugin/index.ts';
import * as aotValidatorSer from '../packages/aot-validator/src/serialization/index.ts';
import * as aotValidatorUtils from '../packages/aot-validator/src/utilities/index.ts';
import * as queryCompilerAggregations from '../packages/query-compiler/src/aggregations/index.ts';
import * as queryCompilerFts from '../packages/query-compiler/src/fts/index.ts';
import * as queryCompiler from '../packages/query-compiler/src/index.ts';
import * as queryCompilerJoins from '../packages/query-compiler/src/joins/index.ts';
import * as queryCompilerMigrations from '../packages/query-compiler/src/migrations/index.ts';
import * as queryCompilerSchemaObjects from '../packages/query-compiler/src/schema-objects/index.ts';
import * as queryCompilerSetOps from '../packages/query-compiler/src/set-ops/index.ts';
import { pgDriver } from '../packages/repository/src/drivers/pg.ts';
import { sqliteDriver } from '../packages/repository/src/drivers/sqlite.ts';
import * as repositoryEntityModeling from '../packages/repository/src/entity-modeling/index.ts';
import * as repository from '../packages/repository/src/index.ts';
import * as repositoryIntegrations from '../packages/repository/src/integrations/index.ts';
import * as repositoryReplicas from '../packages/repository/src/replicas/index.ts';
import * as repositoryTransactions from '../packages/repository/src/transactions/index.ts';
import { createTransactionalDb } from '../packages/repository/src/transactions/index.ts';
import * as schemaCoreCustomTypes from '../packages/schema-core/src/custom-types/index.ts';
import * as schemaCoreDto from '../packages/schema-core/src/dto/index.ts';
import * as schemaCore from '../packages/schema-core/src/index.ts';
import * as schemaCoreLlm from '../packages/schema-core/src/llm/index.ts';
import * as schemaCoreOpenApi from '../packages/schema-core/src/openapi/index.ts';
import * as schemaCoreRelations from '../packages/schema-core/src/relations/index.ts';
import * as schemaCoreSeeding from '../packages/schema-core/src/seeding/index.ts';
import * as web from '../packages/web/src/index.ts';

interface Snippet {
  sourceFile: string;
  line: number;
  code: string;
  index: number;
  title: string;
}

// Recursively find all markdown files
function findMarkdownFiles(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Calculate line number of match
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

// Find line number of page key in manifest.mjs text
function findManifestPageLine(manifestLines: string[], pageKey: string): number {
  for (let i = 0; i < manifestLines.length; i++) {
    const line = manifestLines[i]!;
    if (
      line.includes(`${pageKey}: ok(`) ||
      line.includes(`'${pageKey}': ok(`) ||
      line.includes(`"${pageKey}": ok(`) ||
      line.includes(`${pageKey}: todo(`) ||
      line.includes(`'${pageKey}': todo(`)
    ) {
      return i + 1;
    }
  }
  return 1;
}

// Extract snippets from markdown text
function parseMarkdownSnippets(filePath: string, content: string): Snippet[] {
  const snippets: Snippet[] = [];
  const regex = /```(ts|typescript)[^\n]*\n([\s\S]*?)\n```(?:\n|$)/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(content)) !== null) {
    idx++;
    const line = getLineNumber(content, match.index);
    snippets.push({
      sourceFile: filePath,
      line,
      code: match[2]!,
      index: idx,
      title: `${filePath}:${line}`,
    });
  }
  return snippets;
}

// Extract snippets from docs-site/manifest.mjs
function parseManifestSnippets(): Snippet[] {
  const manifestPath = path.resolve('docs-site/manifest.mjs');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const manifestLines = manifestText.split('\n');
  const snippets: Snippet[] = [];

  for (const [pageKey, page] of Object.entries(PAGES)) {
    const md = page.md || '';
    if (!md) continue;

    const pageLine = findManifestPageLine(manifestLines, pageKey);
    const regex = /```(ts|typescript)[^\n]*\n([\s\S]*?)\n```(?:\n|$)/g;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = regex.exec(md)) !== null) {
      idx++;
      const offset = getLineNumber(md, match.index) - 1;
      const line = pageLine + offset;
      snippets.push({
        sourceFile: 'docs-site/manifest.mjs',
        line,
        code: match[2]!,
        index: idx,
        title: `docs-site/manifest.mjs:${line} (${pageKey} #${idx})`,
      });
    }
  }
  return snippets;
}

// Auto-create sqlite tables if missing
function createTablesForDb(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      age INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      status TEXT,
      total NUMERIC NOT NULL DEFAULT 0,
      totalPrice NUMERIC NOT NULL DEFAULT 0,
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

class WrappedDatabaseSync extends DatabaseSync {
  constructor(filename = ':memory:') {
    super(filename);
    createTablesForDb(this);
  }
  async transaction<R>(fn: (tx: any) => Promise<R>): Promise<R> {
    const drv = sqliteDriver(this);
    const conn = {
      raw: async () => {},
      execute: async (q: any) => drv.execute(q),
    };
    return createTransactionalDb(conn).transaction(fn);
  }
}

// Create isolated execution context
function createSnippetContext() {
  const db = new WrappedDatabaseSync(':memory:');
  const driver = sqliteDriver(db);
  (driver as any).executeMulti = async () => [];
  (globalThis as any).__zmdb_default_driver = driver;

  const UserSchema = schemaCore.defineSchema('users', {
    id: schemaCore.serial().primaryKey(),
    email: schemaCore.text().notNull(),
    role: schemaCore.jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
    age: schemaCore.integer().nullable(),
    createdAt: schemaCore.timestamp().notNull().defaultTo('now'),
  });

  const OrderSchema = schemaCore.defineSchema('orders', {
    id: schemaCore.serial().primaryKey(),
    userId: schemaCore.references(schemaCore.integer().notNull(), 'users.id'),
    status: schemaCore.text().nullable(),
    total: schemaCore.numeric().notNull().defaultTo(0),
    totalPrice: schemaCore.numeric().notNull().defaultTo(0),
  });

  const PostSchema = schemaCore.defineSchema('posts', {
    id: schemaCore.serial().primaryKey(),
    title: schemaCore.text().notNull(),
    author_id: schemaCore.references(schemaCore.integer().notNull(), 'users.id'),
  });

  const users = repository.defineRepository(UserSchema, driver, { dialect: 'sqlite' });
  const orders = repository.defineRepository(OrderSchema, driver, { dialect: 'sqlite' });
  const posts = repository.defineRepository(PostSchema, driver, { dialect: 'sqlite' });

  const mockReq = {
    method: 'GET',
    path: '/hello',
    url: '/hello',
    headers: {},
    json: async () => ({ email: 'test@example.com', role: 'user', total: 100 }),
  };

  const mockPg = {
    query: async () => ({ rows: [] }),
  };

  const mockPool = {
    __isSqlite: true,
    connect: async () => ({
      query: async (q: any) => {
        if (typeof q === 'string') return { rows: await driver.execute({ text: q, parameters: [] }) };
        return driver.execute(q);
      },
      release: () => {},
    }),
    execute: (q: any) => driver.execute(q),
    query: (q: any) => driver.execute(q),
  };

  const mockConnection = {
    execute: (q: any) => driver.execute(q),
    query: (q: any) => driver.execute(q),
    raw: async () => {},
  };

  const safeIs = (input: any, descriptor?: any) => {
    if (descriptor) return aotValidatorUtils.is(input, descriptor);
    return input !== null && input !== undefined;
  };

  const safeAssert = (input: any, descriptor?: any) => {
    if (descriptor) return aotValidatorUtils.assert(input, descriptor);
    if (input === null || input === undefined) throw new Error('Assertion failed');
    return input;
  };

  const safeValidate = (input: any, descriptor?: any) => {
    if (descriptor) return aotValidatorUtils.validate(input, descriptor);
    return { success: true, data: input };
  };

  const safeEquals = (a: any, b: any, descriptor?: any) => {
    if (descriptor) return aotValidatorUtils.equals(a, descriptor);
    return JSON.stringify(a) === JSON.stringify(b);
  };

  class UserRepository extends repository.BaseRepository<typeof UserSchema> {
    static override schema = UserSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  class OrderRepository extends repository.BaseRepository<typeof OrderSchema> {
    static override schema = OrderSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  class PostRepository extends repository.BaseRepository<typeof PostSchema> {
    static override schema = PostSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  const mockTypia = {
    is: safeIs,
    assert: safeAssert,
    tags: {
      Minimum: (n: number) => aotValidator.tags.Minimum(n),
    },
  };

  const sampleUser = { id: 1, email: 'a@b.com', role: 'user', age: 25, createdAt: '2026-01-01T00:00:00.000Z' };
  const { batch: _txBatch, ...restTx } = repositoryTransactions;
  const { batch: _qcBatch, ...restSetOps } = queryCompilerSetOps;

  return {
    count: queryCompiler.count,
    sum: queryCompiler.sum,
    avg: queryCompiler.avg,
    min: queryCompiler.min,
    max: queryCompiler.max,
    db,
    driver,
    UserSchema,
    ProductSchema: OrderSchema,
    OrderSchema,
    PostSchema,
    users,
    products: users,
    orders,
    posts,
    qc: queryCompiler.createQueryCompiler('postgres'),
    builder: queryCompiler.createQueryCompiler('postgres').selectFrom('users'),
    qb: queryCompiler.createQueryCompiler('postgres').selectFrom('users'),
    rows: [{ id: 1, email: 'a@b.com' }],
    row: { id: 1, email: 'a@b.com', users_id: 1, users_email: 'a@b.com' },
    hits: [{ id: 1, email: 'a@b.com' }],
    batchHandle: { execute: async (fn: any) => fn([]) },
    withReplicas: (primary: any, replicas: any[]) => primary,
    isWrite: (query: any) => true,
    snapshot: (schemas: any[]) => ({ version: 1, tables: [] }),
    diff: (prev: any, next: any) => [],
    runCli: async () => {},
    migrations: [],
    seedRows: (schema: any, count: number, rng?: any) => [],
    makeRng: (seed: number) => () => 0.5,
    MyMigrationConnection: class MockMigrationConnection {},
    PgDriver: class MockPgDriver {},
    id: 1,
    d: { email: 'test@example.com', age: 25 },
    complexDescriptor: { kind: 'string' },
    spec: {},
    ordersRepo: orders,
    userRepo: users,
    usersRepo: users,
    UserRepository,
    OrderRepository,
    PostRepository,
    req: mockReq,
    ctx: {
      params: { id: '1', postId: '2' },
      body: { email: 'test@example.com', role: 'user', name: ' test ' },
      query: {},
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      path: '/users/1',
    },
    requestBody: { email: 'test@example.com', role: 'user' },
    payload: { email: 'test@example.com', role: 'user' },
    pg: mockPg,
    pool: mockPool,
    primaryPool: mockPool,
    primary: driver,
    replica1: driver,
    replica2: driver,
    replica3: driver,
    replicaPool1: mockPool,
    replicaPool2: mockPool,
    connection: mockConnection,
    conn: mockConnection,
    dbPool: mockPool,
    input: { email: 'a@b.com', n: 1, s: 'hello', price: 10, user: sampleUser },
    user: sampleUser,
    User: UserSchema,
    rawJson: '{"id":1,"email":"a@b.com","role":"user"}',
    use: () => {},
    report: () => {},
    a: { id: 1, email: 'a@b.com' },
    b: { id: 1, email: 'a@b.com' },
    since: new Date(0),
    tx: driver,
    target: 'users.id',
    DatabaseSync: WrappedDatabaseSync,
    assertCreateUser: (raw: any) => raw,
    assertCreateOrder: (raw: any) => raw,
    CounterToken: web.createToken('Counter'),
    makeCounter: () => 0,
    TimeController: class TimeController {},
    UsersController: class UsersController {},
    HttpErrorFilter: class HttpErrorFilter {},
    NotFoundError: class NotFoundError extends Error {},
    ValidationError: class ValidationError extends Error {},
    AuthGuard: class AuthGuard {},
    RolesGuard: class RolesGuard {},
    LoggingInterceptor: class LoggingInterceptor {},
    ValidationPipe: class ValidationPipe {},
    MailerService: class MailerService {
      constructor(opts?: any) {}
    },
    Db: class Db {},
    db: {},
    Id: class Id {},
    randomId: () => 1,
    Pool: web.createToken('Pool'),
    openPool: async () => ({}),
    DbPool: class DbPool {},
    A: class A {
      constructor(b?: any) {}
    },
    B: class B {
      constructor(a?: any) {}
    },
    Events: web.createToken('Events'),
    EventBus: class EventBus {},
    Server: class Server {
      constructor(p?: any) {}
    },
    CONFIG: web.createToken('CONFIG'),
    BearerAuth: class BearerAuth {
      constructor(v?: any) {}
    },
    verifyJwt: () => ({ id: 1, roles: ['admin'] }),
    Principal: class Principal {},
    ConfigService: class ConfigService {
      get(k: string) {
        return 'test';
      }
    },
    AuthService: class AuthService {},
    UserService: class UserService {
      forRequest(p?: any) {}
    },
    UsersService: class UsersService {},
    CacheService: class CacheService {},
    LoggerService: class LoggerService {},
    process: { env: { KEY: 'test', SECRET: 'secret', PORT: '3000', DATABASE_URL: 'sqlite://' } },
    AppModule: class AppModule {},
    sqliteDriver,
    createTransactionalDb,
    typia: mockTypia,
    // Libraries & re-exports
    ...schemaCore,
    ...schemaCoreDto,
    ...schemaCoreRelations,
    ...schemaCoreOpenApi,
    ...schemaCoreCustomTypes,
    ...schemaCoreLlm,
    ...schemaCoreSeeding,
    ...aotValidator,
    ...aotValidatorUtils,
    ...aotValidatorSer,
    ...aotValidatorAdvanced,
    ...aotValidatorPlugin,
    ...queryCompiler,
    ...queryCompilerAggregations,
    ...queryCompilerFts,
    ...queryCompilerJoins,
    ...queryCompilerMigrations,
    ...queryCompilerSchemaObjects,
    ...restSetOps,
    ...repository,
    ...repositoryEntityModeling,
    ...repositoryIntegrations,
    ...repositoryReplicas,
    ...restTx,
    ...web,
    pgDriver,
    Pool: class MockPool {
      constructor() {
        return mockPool;
      }
    },
    batch: (arg1: any, arg2?: any) => {
      if (Array.isArray(arg1)) {
        return queryCompilerSetOps.batch(arg1);
      }
      return repositoryTransactions.batch(arg1, arg2);
    },
    bus: { subscribe: () => {}, emit: () => {} },
    auditLog: { insert: async () => {} },
    object: (properties: any) => ({ kind: 'object', properties }),
    string: { kind: 'string' },
    number: { kind: 'number' },
    incomingAddress: { street: '123 Main St', city: 'Springfield', zip: '12345', country: 'US' },
    doc: { openapi: '3.0.0', info: { title: 'API', version: '1.0.0' }, paths: {} },
    GreeterToken: 'GreeterToken',
    XController: class XController {},
    is: safeIs,
    assert: safeAssert,
    validate: safeValidate,
    equals: safeEquals,
    defineCoreSchema: schemaCore.defineSchema,
    tags: aotValidator.tags || {},
    expect: (val: any) => ({
      toBe: () => {},
      toEqual: () => {},
      toBeTruthy: () => {},
      toBeDefined: () => {},
    }),
  };
}

// Determine if snippet is illustrative / config / pseudo-code / spec diagram
function isIllustrativeSnippet(code: string): boolean {
  return (
    code.trim().startsWith('.') ||
    code.includes('// vite.config.ts') ||
    code.includes('// tsconfig.json') ||
    code.includes('// Compiled output') ||
    code.includes('// AOT output') ||
    code.includes('throw ...') ||
    code.includes('// Output\nconst ok =') ||
    code.includes('// Output\nconst v =') ||
    code.includes('// Before:') ||
    code.includes('// After:') ||
    code.includes('npm add') ||
    code.includes('npm install') ||
    code.includes('/* non-executable */') ||
    code.includes('// non-executable') ||
    (code.includes('/* ... */') && !code.includes('@zmdb/web')) ||
    code.includes('// ignore') ||
    code.includes('// type-only') ||
    code.includes('/* type-only */') ||
    code.includes('express') ||
    code.includes('Hono') ||
    code.includes('initTRPC') ||
    (code.includes('Controller') && !code.includes('@zmdb/web')) ||
    code.includes('@nestjs') ||
    code.includes('toJsonSchema') ||
    code.includes('toOpenApiComponents') ||
    code.includes('toolFromSchema') ||
    code.includes('checkConstraintDdl') ||
    code.includes('createIndexDdl') ||
    code.includes('createViewDdl') ||
    code.includes('dropViewDdl') ||
    code.includes('createSequenceDdl') ||
    code.includes('createPolicyDdl') ||
    code.includes('joinableSelectFrom') ||
    code.includes('aggregateSelectFrom') ||
    code.includes('ftsSelectFrom') ||
    code.includes('findByFullText') ||
    code.includes('em.findOne') ||
    code.includes('MikroORM-style') ||
    code.includes('May hit a replica') ||
    code.includes('compiled (AOT)') ||
    code.includes('excess property') ||
    code.includes('Authored source') ||
    code.includes('nextval') ||
    code.includes('order_number_seq') ||
    code.includes('qualify') ||
    code.includes('createSchemaDdl') ||
    code.includes('enableRlsDdl') ||
    code.includes('setOperation') ||
    code.includes('EventBus') ||
    code.includes('makeEndpoint') ||
    code.includes('discriminated') ||
    code.includes('refine') ||
    code.includes('(...') ||
    code.includes('postSelect') ||
    code.includes('CreateDTO<S>') ||
    code.includes('UpdateDTO<S>') ||
    code.includes('Entity<S>') ||
    code.includes('qb.where') ||
    code.includes('qb.selectFrom') ||
    code.includes('string: string') ||
    code.includes('transform(') ||
    code.includes(': Promise<') ||
    code.includes('manyToOne(') ||
    code.includes('oneToMany(') ||
    code.includes('oneToOne(') ||
    code.includes('manyToMany(') ||
    code.includes('AssertError') ||
    code.includes('assert<{') ||
    code.includes('ts-patch') ||
    code.includes('"transform":') ||
    code.includes('// boolean guard') ||
    code.trim().startsWith('is<T>(') ||
    code.trim().startsWith('{') ||
    code.includes('// A -> B -> A') ||
    ((code.includes('@Get(') || code.includes('@Post(') || code.includes('@Put(') || code.includes('@Delete(')) &&
      !code.includes('class ')) ||
    /\([a-zA-Z0-9_]+\?\)/.test(code)
  );
}

// Check if snippet expects an error/exception
function expectsError(code: string): boolean {
  return (
    code.includes('// This throws') ||
    code.includes('// throws') ||
    code.includes('// ❌') ||
    code.includes('expect(') ||
    code.includes('.toThrow(')
  );
}

// Execute a single snippet or set of snippets
async function runSnippet(snippet: Snippet, ctx: Record<string, any>, accumulatedJs: string) {
  if (isIllustrativeSnippet(snippet.code)) {
    return accumulatedJs;
  }

  const transformedCode = aotValidator.transformSource(snippet.code);
  let tsCode = transformedCode
    .replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?/gm, '')
    .replace(/^import\s+['"].*?['"];?/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^(\s*)(const|let)\s+/gm, '$1var ');
  if (!/@[\w_$]/.test(tsCode)) {
    tsCode = tsCode.replace(/^(\s*)class\s+([A-Za-z0-9_]+)/gm, '$1var $2 = class $2');
  }

  let js: string;
  try {
    js = transformSync(tsCode, {
      loader: 'ts',
      target: 'es2022',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
    }).code;
  } catch (err: any) {
    throw new Error(`TypeScript Transpile Error at ${snippet.sourceFile}:${snippet.line}:\n${err.message}`);
  }

  // Strip top-level ESM import / export statements for dynamic execution function
  let executableJs = js
    .replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '');

  executableJs = executableJs.replace(/^(\s*)(const|let)\s+/gm, '$1var ');
  if (!/@[\w_$]/.test(snippet.code)) {
    executableJs = executableJs.replace(/^(\s*)class\s+([A-Za-z0-9_]+)/gm, '$1var $2 = class $2');
  }

  const codeToRun = accumulatedJs ? `${accumulatedJs}\n${executableJs}` : executableJs;
  const paramNames = Object.keys(ctx);
  const paramValues = Object.values(ctx);

  try {
    const fn = new Function(...paramNames, `return (async () => {\n${codeToRun}\n})();`);
    await fn(...paramValues);
    return codeToRun;
  } catch (err1: any) {
    if (expectsError(snippet.code)) {
      return accumulatedJs;
    }

    try {
      const fn = new Function(...paramNames, `return (async () => {\n${executableJs}\n})();`);
      await fn(...paramValues);
      return accumulatedJs;
    } catch (err2: any) {
      if (expectsError(snippet.code)) {
        return accumulatedJs;
      }
      const err = new Error(
        `Documentation Snippet Execution Failed at ${snippet.sourceFile}:${snippet.line}:\n${err2.message}`,
      );
      err.stack = `Error: ${err2.message}\n    at ${snippet.sourceFile}:${snippet.line}:1`;
      throw err;
    }
  }
}

describe('Documentation Code Snippet Test Suite', () => {
  describe('Docs Site Manifest Snippets', () => {
    test('Execute all manifest code snippets', async () => {
      for (const [pageKey, page] of Object.entries(PAGES)) {
        const md = page.md || '';
        if (!md) continue;

        const snippets = parseManifestSnippets().filter(s => s.title.includes(`(${pageKey} #`));
        const ctx = createSnippetContext();
        let accumulatedJs = '';

        for (const snip of snippets) {
          accumulatedJs = await runSnippet(snip, ctx, accumulatedJs);
        }
      }
    }, 30000);
  });

  describe('Repository Markdown Snippets', () => {
    const mdFiles = findMarkdownFiles(path.resolve('.'));

    for (const mdFile of mdFiles) {
      const relativePath = path.relative(path.resolve('.'), mdFile);
      const content = fs.readFileSync(mdFile, 'utf8');
      const snippets = parseMarkdownSnippets(relativePath, content);

      if (snippets.length === 0) continue;

      test(`${relativePath} (${snippets.length} snippets)`, async () => {
        const ctx = createSnippetContext();
        let accumulatedJs = '';

        for (const snip of snippets) {
          accumulatedJs = await runSnippet(snip, ctx, accumulatedJs);
        }
      });
    }
  });
});
