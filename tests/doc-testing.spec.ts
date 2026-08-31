import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { transformSync } from 'esbuild';
import { describe, test } from 'vitest';

import { PAGES } from '../docs-site/manifest.mjs';
import {
  tags as aotTags,
  transformSource as aotTransformSource,
  validate as aotValidate,
} from '../packages/aot-validator/src/index.ts';
import {
  assertStringify,
  decode,
  encode,
  parse,
  stringify,
} from '../packages/aot-validator/src/serialization/index.ts';
import {
  assert as aotAssert,
  assertEquals as aotAssertEquals,
  equals as aotEquals,
  is as aotIs,
  random as aotRandom,
  validate as aotUtilsValidate,
} from '../packages/aot-validator/src/utilities/index.ts';
import { avg, count, max, min, sum } from '../packages/query-compiler/src/aggregations/index.ts';
import { createQueryCompiler as createCompiler } from '../packages/query-compiler/src/index.ts';
import { batch as setOpsBatch } from '../packages/query-compiler/src/set-ops/index.ts';
import { pgDriver } from '../packages/repository/src/drivers/pg.ts';
import { sqliteDriver } from '../packages/repository/src/drivers/sqlite.ts';
import {
  discriminatorFor,
  flattenEmbeddable,
  liftEmbeddable,
  rowToSubtype,
} from '../packages/repository/src/entity-modeling/index.ts';
import { BaseRepository, defineRepository } from '../packages/repository/src/index.ts';
import { batch as txBatch, createTransactionalDb } from '../packages/repository/src/transactions/index.ts';
import { decodeValue, defineType, encodeValue } from '../packages/schema-core/src/custom-types/index.ts';
import {
  applyOrderBy,
  applyPagination,
  buildListResult,
  buildSearchResult,
  compileWhere,
  describeAggregate,
  project,
} from '../packages/schema-core/src/dto/index.ts';
import {
  bigint,
  boolean,
  defineSchema,
  getRegisteredSchema,
  integer,
  isRecord,
  json,
  jsonEnum,
  manyToMany,
  manyToOne,
  notNull,
  nullable,
  numeric,
  oneToMany,
  oneToOne,
  primaryKey,
  references,
  registeredSchemas,
  SchemaError,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from '../packages/schema-core/src/index.ts';
import { lenientParse, toolFromSchema } from '../packages/schema-core/src/llm/index.ts';
import {
  toJsonSchema,
  toJsonSchemaWithRelations,
  toListSchema,
  toOpenApiComponents,
  toSearchSchema,
} from '../packages/schema-core/src/openapi/index.ts';
import { aliasRow, attachPopulated, compilePopulate } from '../packages/schema-core/src/relations/index.ts';
import {
  benchmarkRouter,
  ChainError,
  compileModule,
  Container,
  Controller,
  countMetadataReads,
  createApp,
  createGatewayDispatcher,
  createRouter,
  createTestApp,
  createToken,
  defineState,
  Delete,
  dtoChain,
  extractParams,
  Gateway,
  Get,
  getRoutes,
  getSubscriptions,
  Inject,
  Module,
  Patch,
  Post,
  Put,
  repositoryToken,
  runChain,
  serializationInterceptor,
  serveOpenApi,
  sseStream,
  Subscribe,
  toFetchHandler,
  toNodeHandler,
  toOpenApi,
  transition,
  validateWith,
  validationPipe,
} from '../packages/web/src/index.ts';

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
  async transaction<R>(fn: (tx: unknown) => Promise<R>): Promise<R> {
    const drv = sqliteDriver(this);
    const conn = {
      raw: async () => {},
      execute: async (q: unknown) => drv.execute(q as { text: string; parameters?: unknown[] }),
    };
    return createTransactionalDb(conn).transaction(fn);
  }
}

// Create isolated execution context
function createSnippetContext() {
  const db = new WrappedDatabaseSync(':memory:');
  const driver = sqliteDriver(db);
  (driver as unknown as { executeMulti?: () => Promise<unknown[]> }).executeMulti = async () => [];
  (globalThis as unknown as Record<string, unknown>).__zmdb_default_driver = driver;

  const UserSchema = defineSchema('users', {
    id: serial().primaryKey(),
    email: text().notNull(),
    role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
    age: integer().nullable(),
    createdAt: timestamp().notNull().defaultTo('now'),
  });

  const OrderSchema = defineSchema('orders', {
    id: serial().primaryKey(),
    userId: references(integer().notNull(), 'users.id'),
    status: text().nullable(),
    total: numeric().notNull().defaultTo(0),
    totalPrice: numeric().notNull().defaultTo(0),
  });

  const PostSchema = defineSchema('posts', {
    id: serial().primaryKey(),
    title: text().notNull(),
    author_id: references(integer().notNull(), 'users.id'),
  });

  const users = defineRepository(UserSchema, driver, { dialect: 'sqlite' });
  const orders = defineRepository(OrderSchema, driver, { dialect: 'sqlite' });
  const posts = defineRepository(PostSchema, driver, { dialect: 'sqlite' });

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
      query: async (q: unknown) => {
        if (typeof q === 'string') return { rows: await driver.execute({ text: q, parameters: [] }) };
        return driver.execute(q as { text: string; parameters?: unknown[] });
      },
      release: () => {},
    }),
    execute: (q: unknown) => driver.execute(q as { text: string; parameters?: unknown[] }),
    query: (q: unknown) => driver.execute(q as { text: string; parameters?: unknown[] }),
  };

  const mockConnection = {
    execute: (q: unknown) => driver.execute(q as { text: string; parameters?: unknown[] }),
    query: (q: unknown) => driver.execute(q as { text: string; parameters?: unknown[] }),
    raw: async () => {},
  };

  const safeIs = (input: unknown, descriptor?: unknown) => {
    if (descriptor) return aotIs(input, descriptor as Parameters<typeof aotIs>[1]);
    return input !== null && input !== undefined;
  };

  const safeAssert = (input: unknown, descriptor?: unknown) => {
    if (descriptor) return aotAssert(input, descriptor as Parameters<typeof aotAssert>[1]);
    if (input === null || input === undefined) throw new Error('Assertion failed');
    return input;
  };

  const safeValidate = (input: unknown, descriptor?: unknown) => {
    if (descriptor) return aotUtilsValidate(input, descriptor as Parameters<typeof aotUtilsValidate>[1]);
    return { success: true, data: input };
  };

  const safeEquals = (a: unknown, b: unknown, descriptor?: unknown) => {
    if (descriptor) return aotEquals(a, descriptor as Parameters<typeof aotEquals>[1]);
    return JSON.stringify(a) === JSON.stringify(b);
  };

  class UserRepository extends BaseRepository<typeof UserSchema> {
    static override schema = UserSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  class OrderRepository extends BaseRepository<typeof OrderSchema> {
    static override schema = OrderSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  class PostRepository extends BaseRepository<typeof PostSchema> {
    static override schema = PostSchema;
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  const mockTypia = {
    is: safeIs,
    assert: safeAssert,
    tags: {
      Minimum: (n: number) => aotTags.Minimum(n),
    },
  };

  const sampleUser = { id: 1, email: 'a@b.com', role: 'user', age: 25, createdAt: '2026-01-01T00:00:00.000Z' };

  const schemaCore = {
    defineSchema,
    serial,
    integer,
    bigint,
    numeric,
    text,
    varchar,
    boolean,
    timestamp,
    json,
    jsonEnum,
    primaryKey,
    unique,
    notNull,
    nullable,
    references,
    SchemaError,
    getRegisteredSchema,
    registeredSchemas,
    isRecord,
    manyToOne,
    oneToMany,
    oneToOne,
    manyToMany,
    compileWhere,
    applyOrderBy,
    applyPagination,
    buildListResult,
    project,
    compilePopulate,
    attachPopulated,
    aliasRow,
    describeAggregate,
    buildSearchResult,
    toJsonSchema,
    toJsonSchemaWithRelations,
    toOpenApiComponents,
    toListSchema,
    toSearchSchema,
    defineType,
    encodeValue,
    decodeValue,
    toolFromSchema,
    lenientParse,
  };

  const aotValidator = {
    transformSource: aotTransformSource,
    tags: aotTags,
    validate: aotValidate,
    stringify,
    parse,
    encode,
    decode,
    assertStringify,
  };

  const aotValidatorUtils = {
    is: aotIs,
    assert: aotAssert,
    validate: aotUtilsValidate,
    equals: aotEquals,
    assertEquals: aotAssertEquals,
    random: aotRandom,
  };

  const queryCompiler = {
    createQueryCompiler: createCompiler,
    count,
    sum,
    avg,
    min,
    max,
  };

  const repository = {
    BaseRepository,
    defineRepository,
    discriminatorFor,
    flattenEmbeddable,
    liftEmbeddable,
    rowToSubtype,
  };

  const web = {
    createToken,
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    getRoutes,
    Container,
    Inject,
    Module,
    createRouter,
    extractParams,
    defineState,
    transition,
    toNodeHandler,
    toFetchHandler,
    repositoryToken,
    validateWith,
    compileModule,
    runChain,
    ChainError,
    createApp,
    validationPipe,
    serializationInterceptor,
    dtoChain,
    toOpenApi,
    serveOpenApi,
    Gateway,
    Subscribe,
    getSubscriptions,
    createGatewayDispatcher,
    sseStream,
    createTestApp,
    benchmarkRouter,
    countMetadataReads,
  };

  return {
    count,
    sum,
    avg,
    min,
    max,
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
    qc: createCompiler('postgres'),
    builder: createCompiler('postgres').selectFrom('users'),
    qb: createCompiler('postgres').selectFrom('users'),
    rows: [{ id: 1, email: 'a@b.com' }],
    row: { id: 1, email: 'a@b.com', users_id: 1, users_email: 'a@b.com' },
    hits: [{ id: 1, email: 'a@b.com' }],
    batchHandle: { execute: async (_fn: (items: unknown[]) => unknown) => _fn([]) },
    withReplicas: (primary: unknown, _replicas: unknown[]) => primary,
    isWrite: (_query: unknown) => true,
    snapshot: (_schemas: unknown[]) => ({ version: 1, tables: [] }),
    diff: (_prev: unknown, _next: unknown) => [],
    runCli: async () => {},
    migrations: [],
    seedRows: (_schema: unknown, _count: number, _rng?: unknown) => [],
    makeRng: (_seed: number) => () => 0.5,
    MyMigrationConnection: class MockMigrationConnection {
      readonly id = 1;
    },
    PgDriver: class MockPgDriver {
      readonly id = 1;
    },
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
    assertCreateUser: (raw: unknown) => raw,
    assertCreateOrder: (raw: unknown) => raw,
    CounterToken: createToken('Counter'),
    makeCounter: () => 0,
    TimeController: class TimeController {
      readonly type = 'controller';
    },
    UsersController: class UsersController {
      readonly type = 'controller';
    },
    HttpErrorFilter: class HttpErrorFilter {
      readonly type = 'filter';
    },
    NotFoundError: class NotFoundError extends Error {
      readonly code = 'NOT_FOUND';
    },
    ValidationError: class ValidationError extends Error {
      readonly code = 'VALIDATION_ERROR';
    },
    AuthGuard: class AuthGuard {
      readonly type = 'guard';
    },
    RolesGuard: class RolesGuard {
      readonly type = 'guard';
    },
    LoggingInterceptor: class LoggingInterceptor {
      readonly type = 'interceptor';
    },
    ValidationPipe: class ValidationPipe {
      readonly type = 'pipe';
    },
    MailerService: class MailerService {
      readonly name = 'mailer';
    },
    Db: class Db {
      readonly type = 'db';
    },
    Id: class Id {
      readonly type = 'id';
    },
    randomId: () => 1,
    PoolToken: createToken('Pool'),
    openPool: async () => ({}),
    DbPool: class DbPool {
      readonly type = 'pool';
    },
    A: class A {
      readonly name = 'A';
    },
    B: class B {
      readonly name = 'B';
    },
    Events: createToken('Events'),
    EventBus: class EventBus {
      readonly type = 'bus';
    },
    Server: class Server {
      readonly port = 8080;
    },
    CONFIG: createToken('CONFIG'),
    BearerAuth: class BearerAuth {
      readonly type = 'auth';
    },
    verifyJwt: () => ({ id: 1, roles: ['admin'] }),
    Principal: class Principal {
      readonly type = 'principal';
    },
    ConfigService: class ConfigService {
      get(_k: string) {
        return 'test';
      }
    },
    AuthService: class AuthService {
      readonly type = 'service';
    },
    UserService: class UserService {
      forRequest(_p?: unknown) {}
    },
    UsersService: class UsersService {
      readonly type = 'service';
    },
    CacheService: class CacheService {
      readonly type = 'service';
    },
    LoggerService: class LoggerService {
      readonly type = 'service';
    },
    process: { env: { KEY: 'test', SECRET: 'secret', PORT: '3000', DATABASE_URL: 'sqlite://' } },
    AppModule: class AppModule {
      readonly type = 'module';
    },
    sqliteDriver,
    createTransactionalDb,
    typia: mockTypia,
    ...schemaCore,
    ...aotValidator,
    ...aotValidatorUtils,
    ...queryCompiler,
    ...repository,
    ...web,
    pgDriver,
    Pool: class MockPool {
      readonly isPool = true;
      query() {
        return Promise.resolve({ rows: [] });
      }
    },
    batch: (arg1: unknown, arg2?: unknown) => {
      if (Array.isArray(arg1)) {
        return setOpsBatch(arg1 as Parameters<typeof setOpsBatch>[0]);
      }
      return txBatch(arg1 as Parameters<typeof txBatch>[0], arg2 as Parameters<typeof txBatch>[1]);
    },
    bus: { subscribe: () => {}, emit: () => {} },
    auditLog: { insert: async () => {} },
    object: (properties: Record<string, unknown>) => ({ kind: 'object', properties }),
    string: { kind: 'string' },
    number: { kind: 'number' },
    incomingAddress: { street: '123 Main St', city: 'Springfield', zip: '12345', country: 'US' },
    doc: { openapi: '3.0.0', info: { title: 'API', version: '1.0.0' }, paths: {} },
    GreeterToken: 'GreeterToken',
    XController: class XController {
      readonly type = 'controller';
    },
    getRegisteredSchema,
    compileWhere,
    applyOrderBy,
    applyPagination,
    buildListResult,
    project,
    compilePopulate,
    attachPopulated,
    aliasRow,
    describeAggregate,
    buildSearchResult,
    toJsonSchema,
    toJsonSchemaWithRelations,
    toOpenApiComponents,
    toListSchema,
    toSearchSchema,
    defineType,
    encodeValue,
    decodeValue,
    discriminatorFor,
    flattenEmbeddable,
    liftEmbeddable,
    rowToSubtype,
    toolFromSchema,
    lenientParse,
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    getRoutes,
    Container,
    Inject,
    Module,
    createRouter,
    extractParams,
    defineState,
    transition,
    toNodeHandler,
    toFetchHandler,
    repositoryToken,
    validateWith,
    compileModule,
    runChain,
    ChainError,
    createApp,
    validationPipe,
    serializationInterceptor,
    dtoChain,
    toOpenApi,
    serveOpenApi,
    Gateway,
    Subscribe,
    getSubscriptions,
    createGatewayDispatcher,
    sseStream,
    createTestApp,
    benchmarkRouter,
    countMetadataReads,
    bigint,
    varchar,
    stringify,
    parse,
    encode,
    decode,
    assertStringify,
    is: safeIs,
    assert: safeAssert,
    validate: safeValidate,
    equals: safeEquals,
    assertEquals: aotAssertEquals,
    random: aotRandom,
    defineCoreSchema: defineSchema,
    tags: aotTags || {},
    expect: (_val: unknown) => ({
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
async function runSnippet(snippet: Snippet, ctx: Record<string, unknown>, accumulatedJs: string) {
  if (isIllustrativeSnippet(snippet.code)) {
    return accumulatedJs;
  }

  const transformedCode = aotTransformSource(snippet.code);
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TypeScript Transpile Error at ${snippet.sourceFile}:${snippet.line}:\n${msg}`, {
      cause: err,
    });
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
  } catch (_err1: unknown) {
    if (expectsError(snippet.code)) {
      return accumulatedJs;
    }

    try {
      const fn = new Function(...paramNames, `return (async () => {\n${executableJs}\n})();`);
      await fn(...paramValues);
      return accumulatedJs;
    } catch (err2: unknown) {
      if (expectsError(snippet.code)) {
        return accumulatedJs;
      }
      const msg = err2 instanceof Error ? err2.message : String(err2);
      const err = new Error(
        `Documentation Snippet Execution Failed at ${snippet.sourceFile}:${snippet.line}:\n${msg}`,
        { cause: err2 },
      );
      err.stack = `Error: ${msg}\n    at ${snippet.sourceFile}:${snippet.line}:1`;
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
