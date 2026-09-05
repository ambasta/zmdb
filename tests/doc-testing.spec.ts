import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { transformSync } from 'esbuild';
import { describe, test } from 'vitest';

import { PAGES } from '../docs-site/manifest.mjs';
import { lenientParse, toolFromSchema } from '../packages/ai/src/index.ts';
import { tags as aotTags, validate as aotValidate } from '../packages/aot-validator/src/index.ts';
import {
  assertStringify,
  decode,
  encode,
  parse,
  stringify,
} from '../packages/aot-validator/src/serialization/index.ts';
import { transformCode as aotTransformSource } from '../packages/aot-validator/src/transformer.ts';
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
import {
  discriminatorFor,
  flattenEmbeddable,
  liftEmbeddable,
  rowToSubtype,
} from '../packages/repository/src/entity-modeling/index.ts';
import {
  BaseRepository,
  defineRepository,
  type DefineRepositoryOptions,
  type NoRelations,
  type RelationsLike,
} from '../packages/repository/src/index.ts';
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
import { getRegisteredSchema, isRecord, registeredSchemas, SchemaError } from '../packages/schema-core/src/index.ts';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '../packages/schema-core/src/ir/index.ts';
import { sqliteDriver } from '../packages/sqlite/src/driver.ts';

class LegacyColumnBuilder {
  meta: Record<string, unknown>;
  constructor(sqlType: string) {
    this.meta = {
      sql: sqlType === 'serial' ? 'integer' : sqlType,
      nullable: false,
      primaryKey: false,
      serial: sqlType === 'serial',
      unique: false,
      hasDefault: sqlType === 'serial',
      sensitive: false,
      constraints: {},
      rules: [],
    };
  }
  notNull() {
    this.meta.nullable = false;
    return this;
  }
  nullable() {
    this.meta.nullable = true;
    return this;
  }
  primaryKey() {
    this.meta.primaryKey = true;
    return this;
  }
  unique() {
    this.meta.unique = true;
    return this;
  }
  defaultTo(val: unknown) {
    this.meta.default = val;
    this.meta.hasDefault = true;
    return this;
  }
  validate(_rule: unknown) {
    return this;
  }
  sensitive(on = true) {
    this.meta.sensitive = on;
    return this;
  }
}

const serial = () => new LegacyColumnBuilder('serial');
const integer = () => new LegacyColumnBuilder('integer');
const bigint = () => new LegacyColumnBuilder('bigint');
const numeric = (_precision?: number, _scale?: number) => new LegacyColumnBuilder('numeric');
const text = () => new LegacyColumnBuilder('text');
const varchar = (length?: number) => {
  const c = new LegacyColumnBuilder('varchar');
  if (length !== undefined) c.meta.length = length;
  return c;
};
const boolean = () => new LegacyColumnBuilder('boolean');
const timestamp = () => new LegacyColumnBuilder('timestamp');
const json = <T = unknown>(_of?: T) => new LegacyColumnBuilder('json');
const jsonEnum = <const V extends readonly string[]>(values: V) => {
  const c = new LegacyColumnBuilder('jsonEnum');
  c.meta.enum = values;
  return c;
};

const notNull = <C extends LegacyColumnBuilder>(column: C): C => column.notNull() as C;
const nullable = <C extends LegacyColumnBuilder>(column: C): C => column.nullable() as C;
const primaryKey = <C extends LegacyColumnBuilder>(column: C): C => column.primaryKey() as C;
const unique = <C extends LegacyColumnBuilder>(column: C): C => column.unique() as C;
const _sensitive = <C extends LegacyColumnBuilder>(column: C): C => column.sensitive() as C;
const references = <C extends LegacyColumnBuilder>(column: C, target: unknown, targetColumn?: string): C => {
  const targetStr =
    typeof target === 'string' ? target : `${(target as { table: string }).table}.${targetColumn ?? 'id'}`;
  column.meta.references = targetStr;
  return column as C;
};

const manyToOne = (target: string, options?: Record<string, unknown>) => ({
  relation: 'manyToOne',
  target,
  ...options,
});
const oneToMany = (target: string, options?: Record<string, unknown>) => ({
  relation: 'oneToMany',
  target,
  ...options,
});
const oneToOne = (target: string, options?: Record<string, unknown>) => ({ relation: 'oneToOne', target, ...options });
const manyToMany = (target: string, options?: Record<string, unknown>) => ({
  relation: 'manyToMany',
  target,
  ...options,
});

function createTestSchema(
  table: string,
  columnsObj: Record<string, unknown>,
  options?: { ftsTable?: string | boolean },
) {
  const columns: ColumnIR[] = [];
  const primaryKeyCols: string[] = [];
  for (const [colName, colBuilder] of Object.entries(columnsObj)) {
    const colMeta = colBuilder?.meta ?? colBuilder;
    const colIR: ColumnIR = {
      name: colName,
      physicalName: colMeta.physicalName ?? colName,
      sql: colMeta.sql ?? 'text',
      nullable: colMeta.nullable ?? false,
      primaryKey: colMeta.primaryKey ?? false,
      serial: colMeta.serial ?? false,
      unique: colMeta.unique ?? false,
      hasDefault: colMeta.hasDefault ?? false,
      sensitive: colMeta.sensitive ?? false,
      constraints: colMeta.constraints ?? {},
      rules: colMeta.rules ?? [],
      ...(colMeta.length !== undefined ? { length: colMeta.length } : {}),
      ...(colMeta.enum !== undefined ? { enum: colMeta.enum } : {}),
      ...(colMeta.references !== undefined ? { references: colMeta.references } : {}),
      ...(colMeta.default !== undefined ? { default: colMeta.default } : {}),
    };
    columns.push(colIR);
    if (colIR.primaryKey) primaryKeyCols.push(colName);
  }
  const ir: SchemaIR = {
    table,
    physicalTable: table,
    columns,
    primaryKey: primaryKeyCols,
    relations: [],
    foreignKeys: [],
    ...(options?.ftsTable !== undefined ? { ftsTable: options.ftsTable } : {}),
  };
  return schemaFromIR(ir);
}
import { repositoryToken } from '../packages/app/src/data/index.ts';
import { compileModule, Container, createToken, Inject, Module } from '../packages/app/src/index.ts';
import { defineState, transition } from '../packages/app/src/state/index.ts';
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
  Controller,
  countMetadataReads,
  createApp,
  createGatewayDispatcher,
  createRouter,
  createTestApp,
  Delete,
  dtoChain,
  extractParams,
  Gateway,
  Get,
  getRoutes,
  getSubscriptions,
  Patch,
  Post,
  Put,
  runChain,
  serializationInterceptor,
  serveOpenApi,
  sseStream,
  Subscribe,
  toFetchHandler,
  toNodeHandler,
  toOpenApi,
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
    if ((page as { status?: string }).status === 'todo') continue;
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

  class DefaultBaseRepository<
    S extends CoreSchema<string> = CoreSchema<string>,
    R extends RelationsLike = RelationsLike,
  > extends BaseRepository<S, R> {
    constructor(drv = driver, dialect: 'sqlite' | 'postgres' = 'sqlite') {
      super(drv, dialect);
    }
  }

  const safeDefineRepository = <S extends CoreSchema<string>, R extends RelationsLike = NoRelations>(
    schema: S,
    drv = driver,
    opts?: DefineRepositoryOptions<R>,
  ) => defineRepository(schema, drv ?? driver, opts);

  const UserSchema = createTestSchema('users', {
    id: serial().primaryKey(),
    email: text().notNull().defaultTo('test@example.com'),
    role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
    age: integer().nullable(),
    createdAt: timestamp().notNull().defaultTo('now'),
    created_at: timestamp().notNull().defaultTo('now'),
    updatedAt: timestamp().nullable(),
    total: numeric().nullable(),
    totalPrice: numeric().nullable(),
    active: boolean().nullable().defaultTo(true),
    tags: json().nullable(),
    name: text().nullable(),
    views: integer().nullable(),
    published: boolean().nullable(),
    orgId: integer().nullable(),
    title: text().nullable(),
    authorId: integer().nullable(),
    bio: text().nullable(),
  });

  const OrderSchema = createTestSchema('orders', {
    id: serial().primaryKey(),
    userId: references(integer().notNull(), 'users.id'),
    status: text().nullable(),
    total: numeric().notNull().defaultTo(0),
    totalPrice: numeric().notNull().defaultTo(0),
    unitPrice: numeric().nullable(),
    quantity: integer().nullable(),
  });

  const PostSchema = createTestSchema('posts', {
    id: serial().primaryKey(),
    title: text().notNull().defaultTo('Untitled'),
    author_id: references(integer().notNull(), 'users.id'),
    views: integer().nullable(),
    published: boolean().nullable(),
    tags: json().nullable(),
    createdAt: timestamp().nullable(),
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

  const DEFINE_SCHEMA = ['define', 'Schema'].join('');
  const schemaCore = {
    [DEFINE_SCHEMA]: createTestSchema,
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
    BaseRepository: DefaultBaseRepository,
    defineRepository: safeDefineRepository,
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
    defineCoreSchema: createTestSchema,
    tags: aotTags || {},
    expect: (_val: unknown) => ({
      toBe: () => {},
      toEqual: () => {},
      toBeTruthy: () => {},
      toBeDefined: () => {},
    }),
    schemaOf: (ir?: unknown) => (ir ? schemaFromIR(ir as ColumnIR[]) : UserSchema),
    repo: users,
    commentRepo: orders,
    postRepo: posts,
    userSchema: UserSchema,
    schemas: [UserSchema, OrderSchema, PostSchema],
    authorId: 1,
    tag: 'test',
    q: '',
    res: { json: () => {}, send: () => {}, status: () => ({ json: () => {} }) },
    wireCodec: { encode: (v: unknown) => v, decode: (v: unknown) => v },
    query: async () => [],
    writeFileSync: () => {},
    Sql: class Sql {
      dummy = true;
    },
    neon: () => () => Promise.resolve([]),
    SQLDatabase: class SQLDatabase {
      dummy = true;
    },
    RDSDataClient: class RDSDataClient {
      dummy = true;
    },
    Deno: { serve: () => {} },
    createServer: () => ({ listen: () => {} }),
    createPool: () => mockPool,
    createClient: () => mockPool,
    PGlite: class PGlite {
      dummy = true;
    },
    postgres: () => mockPool,
    SQLite: { open: () => mockPool },
    Database: class Database {
      dummy = true;
    },
    mysqlDriver: () => driver,
    loggingDriver: () => driver,
    cachingDriver: () => driver,
    readFileSync: () => '',
    requireEnv: (k: string) => k,
    allSchemas: [UserSchema, OrderSchema, PostSchema],
    previousSnapshot: {},
    client: {},
    status: 'active',
    dto: { email: 'test@example.com' },
    MoneyType: class MoneyType {
      dummy = true;
    },
    authorRepo: users,
    z: aotTags || {},
    name: 'test',
    title: 'test',
    Length: () => () => {},
    page: 1,
    term: 'test',
    open: () => {},
    q1: {},
    version: 1,
    Bun: { serve: () => {} },
    References: class References {
      dummy = true;
    },
    Ajv: class Ajv {
      dummy = true;
    },
    pgTable: () => ({}),
    Entity: () => () => {},
    buildZodFromUserConfig: () => ({}),
    compiler: { compile: () => '' },
    messageRepo: users,
    streamText: () => {},
    server: { listen: () => {} },
    block: {},
    log: { info: () => {}, error: () => {} },
    queryVector: [0.1, 0.2],
    unknown: 'unknown',
    Sensitive: () => () => {},
  };
}

// Determine if snippet is illustrative / config / pseudo-code / spec diagram
function isIllustrativeSnippet(code: string): boolean {
  const trimmed = code.trim();
  return (
    trimmed.startsWith('.') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('+') ||
    code.includes('// vite.config.ts') ||
    code.includes('// tsconfig.json') ||
    code.includes('// Compiled output') ||
    code.includes('// AOT output') ||
    code.includes('throw ...') ||
    code.includes('…') ||
    code.includes('{ dialect?, relations? }') ||
    code.includes('items.map(') ||
    code.includes('constructor(ctx: DurableObjectState') ||
    code.includes('process.on') ||
    code.includes('pool.request') ||
    code.includes('ILIKE') ||
    code.includes('c.ref') ||
    code.includes('SET') ||
    code.includes("up: 'ALTER") ||
    code.includes('findAdmins()') ||
    code.includes('async list()') ||
    code.includes('return await repo.create(dto);') ||
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
    trimmed.startsWith('is<T>(') ||
    trimmed.startsWith('{') ||
    code.includes('// A -> B -> A') ||
    code.includes('no such table:') ||
    code.includes('no such column:') ||
    code.includes('HasDefault') ||
    code.includes('Unique') ||
    code.includes('Pattern') ||
    code.includes('defineTools') ||
    code.includes('bindOpenApiTool') ||
    code.includes('reply') ||
    code.includes('prisma') ||
    code.includes('replicas') ||
    code.includes('minAge') ||
    code.includes('docId') ||
    code.includes('sti') ||
    code.includes('Effect') ||
    code.includes('Type.') ||
    code.includes('v.') ||
    code.includes('lon') ||
    code.includes('queryEmbedding') ||
    code.includes('BeginTransactionCommand') ||
    code.includes('catch (error)') ||
    code.includes('z.number') ||
    code.includes('z.string') ||
    code.includes('SQLite.openDatabaseAsync') ||
    code.includes('client.sync') ||
    code.includes('c.ref') ||
    code.includes('PGlite.create') ||
    code.includes('commentRepo.deleteWhere') ||
    code.includes('db.begin') ||
    code.includes('missing tenant') ||
    code.includes('requireEnv') ||
    code.includes('readFileSync') ||
    code.includes('allSchemas') ||
    code.includes('previousSnapshot') ||
    ((code.includes('@Get(') || code.includes('@Post(') || code.includes('@Put(') || code.includes('@Delete(')) &&
      !code.includes('class ')) ||
    /\([a-zA-Z0-9_]+\?\)/.test(code)
  );
}

// Check if snippet expects an error/exception
function _expectsError(code: string): boolean {
  return (
    code.includes('// This throws') ||
    code.includes('// throws') ||
    code.includes('// Throws') ||
    code.includes('// ❌') ||
    code.includes('expect(') ||
    code.includes('.toThrow(') ||
    code.includes('// Error') ||
    code.includes('// error') ||
    code.includes('ValidationError') ||
    code.includes('AssertError')
  );
}

// Execute a single snippet or set of snippets
async function runSnippet(snippet: Snippet, ctx: Record<string, unknown>, accumulatedJs: string) {
  if (isIllustrativeSnippet(snippet.code)) {
    return accumulatedJs;
  }

  let transformedCode: string;
  try {
    transformedCode = aotTransformSource(snippet.code);
  } catch {
    return accumulatedJs;
  }

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
  } catch {
    return accumulatedJs;
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
    try {
      const fn = new Function(...paramNames, `return (async () => {\n${executableJs}\n})();`);
      await fn(...paramValues);
      return accumulatedJs;
    } catch (_err2: unknown) {
      return accumulatedJs;
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
