import { describe, expect, it } from 'vitest';

import { UnsupportedFeatureError, type CompiledQuery } from '../index.js';

// Tests freeze for issue #506 and ./SPEC.md §7.
//
// The public Dialect union still has three members at the frozen base. Importing
// the future members through a typed call would stop this file at compilation,
// before `it.fails` could record the runtime answer. This is the only widening
// boundary: call the real exported functions through their module namespace,
// validate every returned builder/query, and keep every expectation keyed by the
// six-member dialect tuple. No emitter or builder is stubbed here.
const queryApi: object = await import('../index.js');
const migrationApi: object = await import('../migrations/index.js');
const setOperationApi: object = await import('../set-ops/index.js');
const ftsApi: object = await import('../fts/index.js');
const clausesApi: object = await import('../clauses.js');

const DIALECTS: readonly ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore'] = [
  'postgres',
  'mysql',
  'sqlite',
  'mssql',
  'cockroach',
  'singlestore',
];
type FrozenDialect = (typeof DIALECTS)[number];

const SHIPPED_DIALECTS: readonly ['postgres', 'mysql', 'sqlite'] = ['postgres', 'mysql', 'sqlite'];

const SQL_TYPES: readonly [
  'serial',
  'integer',
  'bigint',
  'numeric',
  'text',
  'varchar',
  'boolean',
  'timestamp',
  'json',
  'jsonEnum',
] = ['serial', 'integer', 'bigint', 'numeric', 'text', 'varchar', 'boolean', 'timestamp', 'json', 'jsonEnum'];

interface FrozenSelectBuilder {
  where(column: string, operator: string, value: unknown): FrozenSelectBuilder;
  andWhere(column: string, operator: string, value: unknown): FrozenSelectBuilder;
  whereIn(column: string, values: readonly unknown[]): FrozenSelectBuilder;
  whereNotIn(column: string, values: readonly unknown[]): FrozenSelectBuilder;
  orderBy(column: string, direction: 'asc' | 'desc'): FrozenSelectBuilder;
  limit(value: number): FrozenSelectBuilder;
  offset(value: number): FrozenSelectBuilder;
  compile(): CompiledQuery;
}

interface FrozenConflictBuilder {
  doUpdate(updateFields?: readonly string[] | Record<string, unknown>): FrozenInsertBuilder;
  doNothing(): FrozenInsertBuilder;
}

interface FrozenInsertBuilder {
  values(row: Record<string, unknown>): FrozenInsertBuilder;
  onConflict(target?: string | readonly string[]): FrozenConflictBuilder;
  returning(columns?: readonly string[]): FrozenInsertBuilder;
  compile(): CompiledQuery;
}

interface FrozenUpdateBuilder {
  set(row: Record<string, unknown>): FrozenUpdateBuilder;
  where(column: string, operator: string, value: unknown): FrozenUpdateBuilder;
  compile(): CompiledQuery;
}

interface FrozenDeleteBuilder {
  where(column: string, operator: string, value: unknown): FrozenDeleteBuilder;
  compile(): CompiledQuery;
}

interface FrozenQueryCompiler {
  selectFrom(table: string): FrozenSelectBuilder;
  insertInto(table: string): FrozenInsertBuilder;
  updateTable(table: string): FrozenUpdateBuilder;
  deleteFrom(table: string): FrozenDeleteBuilder;
}

interface FrozenFtsBuilder {
  whereMatch(column: string, term: string): FrozenFtsBuilder;
  compile(): CompiledQuery;
}

interface FrozenTableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

interface FrozenColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly length?: number;
}

interface FrozenCreateTable {
  readonly kind: 'create_table';
  readonly table: string;
  readonly columns: readonly FrozenColumn[];
  readonly tableOptions?: FrozenTableOptions;
}

type FrozenChangeOp =
  | FrozenCreateTable
  | { readonly kind: 'drop_table'; readonly table: string }
  | { readonly kind: 'add_column'; readonly table: string; readonly column: FrozenColumn }
  | { readonly kind: 'drop_column'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'alter_column_type';
      readonly table: string;
      readonly column: string;
      readonly from: string;
      readonly to: string;
    };

type Outcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | {
      readonly kind: 'refused';
      readonly feature: string;
      readonly dialect: string;
      readonly messageNamesDialect: boolean;
    }
  | { readonly kind: 'error'; readonly name: string; readonly message: string };

interface MatrixCase {
  readonly name: string;
  readonly build: (dialect: FrozenDialect) => unknown;
  readonly expected: Readonly<Record<FrozenDialect, Outcome>>;
}

function hasMethod(candidate: unknown, name: string): boolean {
  return candidate !== null && typeof candidate === 'object' && typeof Reflect.get(candidate, name) === 'function';
}

function isFtsBuilder(candidate: unknown): candidate is FrozenFtsBuilder {
  return hasMethod(candidate, 'whereMatch') && hasMethod(candidate, 'compile');
}

function isCompiler(candidate: unknown): candidate is FrozenQueryCompiler {
  return (
    hasMethod(candidate, 'selectFrom') &&
    hasMethod(candidate, 'insertInto') &&
    hasMethod(candidate, 'updateTable') &&
    hasMethod(candidate, 'deleteFrom')
  );
}

function isCompiledQuery(candidate: unknown): candidate is CompiledQuery {
  if (candidate === null || typeof candidate !== 'object') return false;
  return typeof Reflect.get(candidate, 'text') === 'string' && Array.isArray(Reflect.get(candidate, 'parameters'));
}

function invoke(api: object, name: string, args: readonly unknown[]): unknown {
  const fn: unknown = Reflect.get(api, name);
  if (typeof fn !== 'function') throw new TypeError(`Expected ${name} to be an exported function`);
  return Reflect.apply(fn, undefined, args);
}

function compiler(dialect: FrozenDialect): FrozenQueryCompiler {
  const candidate: unknown = invoke(queryApi, 'createQueryCompiler', [dialect]);
  if (!isCompiler(candidate)) {
    throw new TypeError('createQueryCompiler did not return the frozen builder surface');
  }
  return candidate;
}

function compiled(candidate: unknown, source: string): CompiledQuery {
  if (!isCompiledQuery(candidate)) throw new TypeError(`${source} did not return a CompiledQuery`);
  return candidate;
}

function stringResult(candidate: unknown, source: string): string {
  if (typeof candidate !== 'string') throw new TypeError(`${source} did not return a string`);
  return candidate;
}

function ftsSelectFrom(table: string, dialect: FrozenDialect): FrozenFtsBuilder {
  const candidate: unknown = invoke(ftsApi, 'ftsSelectFrom', [table, dialect]);
  if (!isFtsBuilder(candidate)) {
    throw new TypeError('ftsSelectFrom did not return the frozen FTS builder surface');
  }
  return candidate;
}

function setUnion(queries: readonly CompiledQuery[], dialect: FrozenDialect): CompiledQuery {
  return compiled(invoke(setOperationApi, 'setOperation', ['union', queries, dialect]), 'setOperation');
}

function quoteIdentifier(dialect: FrozenDialect, identifier: string): string {
  return stringResult(invoke(queryApi, 'quoteIdentifier', [dialect, identifier]), 'quoteIdentifier');
}

function ddlType(dialect: FrozenDialect, type: (typeof SQL_TYPES)[number]): string {
  const column: FrozenColumn = {
    name: 'c',
    type,
    nullable: false,
    primaryKey: type === 'serial',
  };
  return stringResult(invoke(migrationApi, 'ddlType', [dialect, column]), 'ddlType');
}

function emitUp(op: FrozenChangeOp, dialect: FrozenDialect): string {
  return stringResult(invoke(migrationApi, 'emitUp', [op, dialect]), 'emitUp');
}

const FROZEN_EXPRESSION = Symbol('zmdb.tests.dialect-matrix-expression');

function expression(name: string, args: readonly unknown[], shape: Record<string, unknown>): unknown {
  const exported: unknown = Reflect.get(queryApi, name);
  if (typeof exported === 'function') return Reflect.apply(exported, undefined, args);
  const publicBrand: unknown = Reflect.get(queryApi, 'EXPR');
  return Object.defineProperty(shape, typeof publicBrand === 'symbol' ? publicBrand : FROZEN_EXPRESSION, {
    value: true,
  });
}

function inc(by: number): unknown {
  return expression('inc', [by], { op: 'add', by });
}

function dec(by: number): unknown {
  return expression('dec', [by], { op: 'sub', by });
}

function mul(by: number): unknown {
  return expression('mul', [by], { op: 'mul', by });
}

function not(): unknown {
  return expression('not', [], { op: 'not' });
}

function concat(withText: string): unknown {
  return expression('concat', [withText], { op: 'concat', with: withText });
}

function coalesce(fallback: string): unknown {
  return expression('coalesce', [fallback], { op: 'coalesce', fallback });
}

function spatialPredicate(
  dialect: FrozenDialect,
  fn: 'st_contains' | 'st_within' | 'st_intersects' | 'st_dwithin',
  column: string,
  geometry: unknown,
  distance?: number,
): CompiledQuery {
  const parameters: unknown[] = [];
  const predicate =
    distance === undefined
      ? { kind: 'spatial', fn, col: column, value: geometry }
      : { kind: 'spatial', fn, col: column, value: geometry, distance };
  const text: string = stringResult(
    invoke(clausesApi, 'renderPredicate', [dialect, predicate, parameters]),
    'renderPredicate',
  );
  return { text, parameters };
}

function capture(run: () => unknown): Outcome {
  try {
    return { kind: 'value', value: run() };
  } catch (error) {
    if (error instanceof UnsupportedFeatureError) {
      return {
        kind: 'refused',
        feature: error.feature,
        dialect: error.dialect,
        messageNamesDialect: error.message.includes(error.dialect),
      };
    }
    return {
      kind: 'error',
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function value(expected: unknown): Outcome {
  return { kind: 'value', value: expected };
}

function query(text: string, parameters: readonly unknown[]): Outcome {
  return value({ text, parameters });
}

function refused(feature: string, dialect: FrozenDialect): Outcome {
  return { kind: 'refused', feature, dialect, messageNamesDialect: true };
}

const geometry = { type: 'Point', coordinates: [77.5946, 12.9716] };

const createEvents: FrozenCreateTable = {
  kind: 'create_table',
  table: 'events',
  columns: [{ name: 'id', type: 'serial', nullable: false, primaryKey: true }],
  tableOptions: { shardKey: ['id'], sortKey: ['id'] },
};

const MATRIX: readonly MatrixCase[] = [
  {
    name: 'select: where + order + limit',
    build: dialect =>
      compiler(dialect)
        .selectFrom('users')
        .where('email', '=', 'a@b.com')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .compile(),
    expected: {
      postgres: query('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10', ['a@b.com']),
      mysql: query('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10', ['a@b.com']),
      sqlite: query('SELECT * FROM "users" WHERE "email" = ? ORDER BY "createdAt" DESC LIMIT 10', ['a@b.com']),
      mssql: query(
        'SELECT * FROM [users] WHERE [email] = @p1 ORDER BY [createdAt] DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY',
        ['a@b.com'],
      ),
      cockroach: query('SELECT * FROM "users" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 10', ['a@b.com']),
      singlestore: query('SELECT * FROM `users` WHERE `email` = ? ORDER BY `createdAt` DESC LIMIT 10', ['a@b.com']),
    },
  },
  {
    name: 'select: chained predicates',
    build: dialect =>
      compiler(dialect).selectFrom('users').where('role', '=', 'admin').andWhere('active', '=', true).compile(),
    expected: {
      postgres: query('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2', ['admin', true]),
      mysql: query('SELECT * FROM `users` WHERE `role` = ? AND `active` = ?', ['admin', true]),
      sqlite: query('SELECT * FROM "users" WHERE "role" = ? AND "active" = ?', ['admin', true]),
      mssql: query('SELECT * FROM [users] WHERE [role] = @p1 AND [active] = @p2', ['admin', true]),
      cockroach: query('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2', ['admin', true]),
      singlestore: query('SELECT * FROM `users` WHERE `role` = ? AND `active` = ?', ['admin', true]),
    },
  },
  {
    name: 'insert: returning',
    build: dialect =>
      compiler(dialect).insertInto('users').values({ email: 'a@b.com', role: 'user' }).returning(['id']).compile(),
    expected: {
      postgres: query('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"', ['a@b.com', 'user']),
      mysql: refused('returning', 'mysql'),
      sqlite: query('INSERT INTO "users" ("email", "role") VALUES (?, ?) RETURNING "id"', ['a@b.com', 'user']),
      mssql: query('INSERT INTO [users] ([email], [role]) OUTPUT INSERTED.[id] VALUES (@p1, @p2)', ['a@b.com', 'user']),
      cockroach: query('INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING "id"', ['a@b.com', 'user']),
      singlestore: refused('returning', 'singlestore'),
    },
  },
  {
    name: 'update: set + where',
    build: dialect => compiler(dialect).updateTable('users').set({ role: 'admin' }).where('id', '=', 1).compile(),
    expected: {
      postgres: query('UPDATE "users" SET "role" = $1 WHERE "id" = $2', ['admin', 1]),
      mysql: query('UPDATE `users` SET `role` = ? WHERE `id` = ?', ['admin', 1]),
      sqlite: query('UPDATE "users" SET "role" = ? WHERE "id" = ?', ['admin', 1]),
      mssql: query('UPDATE [users] SET [role] = @p1 WHERE [id] = @p2', ['admin', 1]),
      cockroach: query('UPDATE "users" SET "role" = $1 WHERE "id" = $2', ['admin', 1]),
      singlestore: query('UPDATE `users` SET `role` = ? WHERE `id` = ?', ['admin', 1]),
    },
  },
  {
    name: 'delete: where',
    build: dialect => compiler(dialect).deleteFrom('users').where('id', '=', 1).compile(),
    expected: {
      postgres: query('DELETE FROM "users" WHERE "id" = $1', [1]),
      mysql: query('DELETE FROM `users` WHERE `id` = ?', [1]),
      sqlite: query('DELETE FROM "users" WHERE "id" = ?', [1]),
      mssql: query('DELETE FROM [users] WHERE [id] = @p1', [1]),
      cockroach: query('DELETE FROM "users" WHERE "id" = $1', [1]),
      singlestore: query('DELETE FROM `users` WHERE `id` = ?', [1]),
    },
  },
  {
    name: 'pagination: offset only',
    build: dialect => compiler(dialect).selectFrom('users').orderBy('id', 'asc').offset(20).compile(),
    expected: {
      postgres: query('SELECT * FROM "users" ORDER BY "id" ASC OFFSET 20', []),
      mysql: query('SELECT * FROM `users` ORDER BY `id` ASC LIMIT 18446744073709551615 OFFSET 20', []),
      sqlite: query('SELECT * FROM "users" ORDER BY "id" ASC LIMIT -1 OFFSET 20', []),
      mssql: query('SELECT * FROM [users] ORDER BY [id] ASC OFFSET 20 ROWS', []),
      cockroach: query('SELECT * FROM "users" ORDER BY "id" ASC OFFSET 20', []),
      singlestore: query('SELECT * FROM `users` ORDER BY `id` ASC LIMIT 18446744073709551615 OFFSET 20', []),
    },
  },
  {
    name: 'pagination: unordered limit',
    build: dialect => compiler(dialect).selectFrom('users').limit(10).compile(),
    expected: {
      postgres: query('SELECT * FROM "users" LIMIT 10', []),
      mysql: query('SELECT * FROM `users` LIMIT 10', []),
      sqlite: query('SELECT * FROM "users" LIMIT 10', []),
      mssql: refused('pagination without ORDER BY', 'mssql'),
      cockroach: query('SELECT * FROM "users" LIMIT 10', []),
      singlestore: query('SELECT * FROM `users` LIMIT 10', []),
    },
  },
  {
    name: 'upsert: update',
    build: dialect =>
      compiler(dialect)
        .insertInto('users')
        .values({ email: 'a@b.com', role: 'user' })
        .onConflict('email')
        .doUpdate(['role'])
        .compile(),
    expected: {
      postgres: query(
        'INSERT INTO "users" ("email", "role") VALUES ($1, $2) ON CONFLICT ("email") DO UPDATE SET "role" = EXCLUDED."role"',
        ['a@b.com', 'user'],
      ),
      mysql: query(
        'INSERT INTO `users` (`email`, `role`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `role` = VALUES(`role`)',
        ['a@b.com', 'user'],
      ),
      sqlite: query(
        'INSERT INTO "users" ("email", "role") VALUES (?, ?) ON CONFLICT ("email") DO UPDATE SET "role" = EXCLUDED."role"',
        ['a@b.com', 'user'],
      ),
      mssql: query(
        'MERGE [users] WITH (HOLDLOCK) AS tgt USING (VALUES (@p1, @p2)) AS src ([email], [role]) ON tgt.[email] = src.[email] WHEN MATCHED THEN UPDATE SET [role] = src.[role] WHEN NOT MATCHED THEN INSERT ([email], [role]) VALUES (src.[email], src.[role]);',
        ['a@b.com', 'user'],
      ),
      cockroach: query(
        'INSERT INTO "users" ("email", "role") VALUES ($1, $2) ON CONFLICT ("email") DO UPDATE SET "role" = EXCLUDED."role"',
        ['a@b.com', 'user'],
      ),
      singlestore: query(
        'INSERT INTO `users` (`email`, `role`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `role` = VALUES(`role`)',
        ['a@b.com', 'user'],
      ),
    },
  },
  {
    name: 'set operation: placeholder continuation',
    build: dialect => {
      const qb = compiler(dialect);
      const first = qb.selectFrom('a').where('x', '=', 1).compile();
      const second = qb.selectFrom('b').where('y', '=', 2).compile();
      return setUnion([first, second], dialect);
    },
    expected: {
      postgres: query('SELECT * FROM "a" WHERE "x" = $1 UNION SELECT * FROM "b" WHERE "y" = $2', [1, 2]),
      mysql: query('SELECT * FROM `a` WHERE `x` = ? UNION SELECT * FROM `b` WHERE `y` = ?', [1, 2]),
      sqlite: query('SELECT * FROM "a" WHERE "x" = ? UNION SELECT * FROM "b" WHERE "y" = ?', [1, 2]),
      mssql: query('SELECT * FROM [a] WHERE [x] = @p1 UNION SELECT * FROM [b] WHERE [y] = @p2', [1, 2]),
      cockroach: query('SELECT * FROM "a" WHERE "x" = $1 UNION SELECT * FROM "b" WHERE "y" = $2', [1, 2]),
      singlestore: query('SELECT * FROM `a` WHERE `x` = ? UNION SELECT * FROM `b` WHERE `y` = ?', [1, 2]),
    },
  },
  {
    name: 'vector operator: l2',
    build: dialect => compiler(dialect).selectFrom('items').where('embedding', 'l2', [0.1, 0.2]).compile(),
    expected: {
      postgres: query('SELECT * FROM "items" WHERE "embedding" <-> $1', [[0.1, 0.2]]),
      mysql: refused('l2', 'mysql'),
      sqlite: refused('l2', 'sqlite'),
      mssql: refused('l2', 'mssql'),
      cockroach: refused('l2', 'cockroach'),
      singlestore: refused('l2', 'singlestore'),
    },
  },
  {
    name: 'vector operator: cosine',
    build: dialect => compiler(dialect).selectFrom('items').where('embedding', 'cosine', [0.1, 0.2]).compile(),
    expected: {
      postgres: query('SELECT * FROM "items" WHERE "embedding" <=> $1', [[0.1, 0.2]]),
      mysql: refused('cosine', 'mysql'),
      sqlite: refused('cosine', 'sqlite'),
      mssql: refused('cosine', 'mssql'),
      cockroach: refused('cosine', 'cockroach'),
      singlestore: refused('cosine', 'singlestore'),
    },
  },
  {
    name: 'vector operator: inner product',
    build: dialect => compiler(dialect).selectFrom('items').where('embedding', 'ip', [0.1, 0.2]).compile(),
    expected: {
      postgres: query('SELECT * FROM "items" WHERE "embedding" <#> $1', [[0.1, 0.2]]),
      mysql: refused('ip', 'mysql'),
      sqlite: refused('ip', 'sqlite'),
      mssql: refused('ip', 'mssql'),
      cockroach: refused('ip', 'cockroach'),
      singlestore: refused('ip', 'singlestore'),
    },
  },
  {
    name: 'spatial predicate: contains',
    build: dialect => spatialPredicate(dialect, 'st_contains', 'area', geometry),
    expected: {
      postgres: query('ST_Contains("area", ST_GeomFromGeoJSON($1))', [geometry]),
      mysql: refused('st_contains', 'mysql'),
      sqlite: refused('st_contains', 'sqlite'),
      mssql: refused('st_contains', 'mssql'),
      cockroach: refused('st_contains', 'cockroach'),
      singlestore: refused('st_contains', 'singlestore'),
    },
  },
  {
    name: 'spatial predicate: within',
    build: dialect => spatialPredicate(dialect, 'st_within', 'area', geometry),
    expected: {
      postgres: query('ST_Within("area", ST_GeomFromGeoJSON($1))', [geometry]),
      mysql: refused('st_within', 'mysql'),
      sqlite: refused('st_within', 'sqlite'),
      mssql: refused('st_within', 'mssql'),
      cockroach: refused('st_within', 'cockroach'),
      singlestore: refused('st_within', 'singlestore'),
    },
  },
  {
    name: 'spatial predicate: intersects',
    build: dialect => spatialPredicate(dialect, 'st_intersects', 'area', geometry),
    expected: {
      postgres: query('ST_Intersects("area", ST_GeomFromGeoJSON($1))', [geometry]),
      mysql: refused('st_intersects', 'mysql'),
      sqlite: refused('st_intersects', 'sqlite'),
      mssql: refused('st_intersects', 'mssql'),
      cockroach: refused('st_intersects', 'cockroach'),
      singlestore: refused('st_intersects', 'singlestore'),
    },
  },
  {
    name: 'spatial predicate: within distance',
    build: dialect => spatialPredicate(dialect, 'st_dwithin', 'location', geometry, 500),
    expected: {
      postgres: query('ST_DWithin("location", ST_GeomFromGeoJSON($1), $2)', [geometry, 500]),
      mysql: refused('st_dwithin', 'mysql'),
      sqlite: refused('st_dwithin', 'sqlite'),
      mssql: refused('st_dwithin', 'mssql'),
      cockroach: refused('st_dwithin', 'cockroach'),
      singlestore: refused('st_dwithin', 'singlestore'),
    },
  },
  {
    name: 'write expression: increment',
    build: dialect =>
      compiler(dialect)
        .updateTable('posts')
        .set({ views: inc(1) })
        .where('id', '=', 7)
        .compile(),
    expected: {
      postgres: query('UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2', [1, 7]),
      mysql: query('UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?', [1, 7]),
      sqlite: query('UPDATE "posts" SET "views" = "views" + ? WHERE "id" = ?', [1, 7]),
      mssql: query('UPDATE [posts] SET [views] = [views] + @p1 WHERE [id] = @p2', [1, 7]),
      cockroach: query('UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2', [1, 7]),
      singlestore: query('UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?', [1, 7]),
    },
  },
  {
    name: 'write expression: decrement',
    build: dialect =>
      compiler(dialect)
        .updateTable('posts')
        .set({ stock: dec(2) })
        .where('id', '=', 7)
        .compile(),
    expected: {
      postgres: query('UPDATE "posts" SET "stock" = "stock" - $1 WHERE "id" = $2', [2, 7]),
      mysql: query('UPDATE `posts` SET `stock` = `stock` - ? WHERE `id` = ?', [2, 7]),
      sqlite: query('UPDATE "posts" SET "stock" = "stock" - ? WHERE "id" = ?', [2, 7]),
      mssql: query('UPDATE [posts] SET [stock] = [stock] - @p1 WHERE [id] = @p2', [2, 7]),
      cockroach: query('UPDATE "posts" SET "stock" = "stock" - $1 WHERE "id" = $2', [2, 7]),
      singlestore: query('UPDATE `posts` SET `stock` = `stock` - ? WHERE `id` = ?', [2, 7]),
    },
  },
  {
    name: 'write expression: multiply',
    build: dialect =>
      compiler(dialect)
        .updateTable('posts')
        .set({ score: mul(3) })
        .where('id', '=', 7)
        .compile(),
    expected: {
      postgres: query('UPDATE "posts" SET "score" = "score" * $1 WHERE "id" = $2', [3, 7]),
      mysql: query('UPDATE `posts` SET `score` = `score` * ? WHERE `id` = ?', [3, 7]),
      sqlite: query('UPDATE "posts" SET "score" = "score" * ? WHERE "id" = ?', [3, 7]),
      mssql: query('UPDATE [posts] SET [score] = [score] * @p1 WHERE [id] = @p2', [3, 7]),
      cockroach: query('UPDATE "posts" SET "score" = "score" * $1 WHERE "id" = $2', [3, 7]),
      singlestore: query('UPDATE `posts` SET `score` = `score` * ? WHERE `id` = ?', [3, 7]),
    },
  },
  {
    name: 'write expression: boolean not',
    build: dialect => compiler(dialect).updateTable('posts').set({ published: not() }).where('id', '=', 7).compile(),
    expected: {
      postgres: query('UPDATE "posts" SET "published" = NOT "published" WHERE "id" = $1', [7]),
      mysql: query('UPDATE `posts` SET `published` = NOT `published` WHERE `id` = ?', [7]),
      sqlite: query('UPDATE "posts" SET "published" = NOT "published" WHERE "id" = ?', [7]),
      mssql: query('UPDATE [posts] SET [published] = ~[published] WHERE [id] = @p1', [7]),
      cockroach: query('UPDATE "posts" SET "published" = NOT "published" WHERE "id" = $1', [7]),
      singlestore: query('UPDATE `posts` SET `published` = NOT `published` WHERE `id` = ?', [7]),
    },
  },
  {
    name: 'write expression: concatenate',
    build: dialect =>
      compiler(dialect)
        .updateTable('posts')
        .set({ title: concat(' (draft)') })
        .where('id', '=', 7)
        .compile(),
    expected: {
      postgres: query('UPDATE "posts" SET "title" = "title" || $1 WHERE "id" = $2', [' (draft)', 7]),
      mysql: query('UPDATE `posts` SET `title` = CONCAT(`title`, ?) WHERE `id` = ?', [' (draft)', 7]),
      sqlite: query('UPDATE "posts" SET "title" = "title" || ? WHERE "id" = ?', [' (draft)', 7]),
      mssql: query('UPDATE [posts] SET [title] = CONCAT([title], @p1) WHERE [id] = @p2', [' (draft)', 7]),
      cockroach: query('UPDATE "posts" SET "title" = "title" || $1 WHERE "id" = $2', [' (draft)', 7]),
      singlestore: query('UPDATE `posts` SET `title` = CONCAT(`title`, ?) WHERE `id` = ?', [' (draft)', 7]),
    },
  },
  {
    name: 'write expression: coalesce',
    build: dialect =>
      compiler(dialect)
        .updateTable('users')
        .set({ nickname: coalesce('anonymous') })
        .where('id', '=', 7)
        .compile(),
    expected: {
      postgres: query('UPDATE "users" SET "nickname" = COALESCE("nickname", $1) WHERE "id" = $2', ['anonymous', 7]),
      mysql: query('UPDATE `users` SET `nickname` = COALESCE(`nickname`, ?) WHERE `id` = ?', ['anonymous', 7]),
      sqlite: query('UPDATE "users" SET "nickname" = COALESCE("nickname", ?) WHERE "id" = ?', ['anonymous', 7]),
      mssql: query('UPDATE [users] SET [nickname] = COALESCE([nickname], @p1) WHERE [id] = @p2', ['anonymous', 7]),
      cockroach: query('UPDATE "users" SET "nickname" = COALESCE("nickname", $1) WHERE "id" = $2', ['anonymous', 7]),
      singlestore: query('UPDATE `users` SET `nickname` = COALESCE(`nickname`, ?) WHERE `id` = ?', ['anonymous', 7]),
    },
  },
  {
    name: 'null predicate: is null',
    build: dialect =>
      compiler(dialect)
        .selectFrom('users')
        .where('deletedAt', 'is null', 'ignored')
        .andWhere('tenantId', '=', 7)
        .compile(),
    expected: {
      postgres: query('SELECT * FROM "users" WHERE "deletedAt" IS NULL AND "tenantId" = $1', [7]),
      mysql: query('SELECT * FROM `users` WHERE `deletedAt` IS NULL AND `tenantId` = ?', [7]),
      sqlite: query('SELECT * FROM "users" WHERE "deletedAt" IS NULL AND "tenantId" = ?', [7]),
      mssql: query('SELECT * FROM [users] WHERE [deletedAt] IS NULL AND [tenantId] = @p1', [7]),
      cockroach: query('SELECT * FROM "users" WHERE "deletedAt" IS NULL AND "tenantId" = $1', [7]),
      singlestore: query('SELECT * FROM `users` WHERE `deletedAt` IS NULL AND `tenantId` = ?', [7]),
    },
  },
  {
    name: 'null predicate: is not null',
    build: dialect =>
      compiler(dialect)
        .selectFrom('users')
        .where('deletedAt', 'is not null', 'ignored')
        .andWhere('active', '=', true)
        .compile(),
    expected: {
      postgres: query('SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL AND "active" = $1', [true]),
      mysql: query('SELECT * FROM `users` WHERE `deletedAt` IS NOT NULL AND `active` = ?', [true]),
      sqlite: query('SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL AND "active" = ?', [true]),
      mssql: query('SELECT * FROM [users] WHERE [deletedAt] IS NOT NULL AND [active] = @p1', [true]),
      cockroach: query('SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL AND "active" = $1', [true]),
      singlestore: query('SELECT * FROM `users` WHERE `deletedAt` IS NOT NULL AND `active` = ?', [true]),
    },
  },
  {
    name: 'cursor-safe select text',
    build: dialect => compiler(dialect).selectFrom('users').where('id', '=', 1).compile(),
    expected: {
      postgres: query('SELECT * FROM "users" WHERE "id" = $1', [1]),
      mysql: query('SELECT * FROM `users` WHERE `id` = ?', [1]),
      sqlite: query('SELECT * FROM "users" WHERE "id" = ?', [1]),
      mssql: query('SELECT * FROM [users] WHERE [id] = @p1', [1]),
      cockroach: query('SELECT * FROM "users" WHERE "id" = $1', [1]),
      singlestore: query('SELECT * FROM `users` WHERE `id` = ?', [1]),
    },
  },
  {
    name: 'full-text search',
    build: dialect => ftsSelectFrom('customers', dialect).whereMatch('company_name', 'ltd').compile(),
    expected: {
      postgres: query(
        `SELECT * FROM "customers" WHERE to_tsvector('english', "company_name") @@ to_tsquery('english', $1)`,
        ['ltd'],
      ),
      mysql: query('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(? IN NATURAL LANGUAGE MODE)', [
        'ltd',
      ]),
      sqlite: refused('full-text search', 'sqlite'),
      mssql: refused('full-text search', 'mssql'),
      cockroach: refused('full-text search', 'cockroach'),
      singlestore: query('SELECT * FROM `customers` WHERE MATCH(`company_name`) AGAINST(? IN NATURAL LANGUAGE MODE)', [
        'ltd',
      ]),
    },
  },
  {
    name: 'type: serial',
    build: dialect => ddlType(dialect, 'serial'),
    expected: {
      postgres: value('SERIAL'),
      mysql: value('INT AUTO_INCREMENT'),
      sqlite: value('INTEGER'),
      mssql: value('INT IDENTITY(1,1)'),
      cockroach: value('INT8 DEFAULT unique_rowid()'),
      singlestore: value('BIGINT AUTO_INCREMENT'),
    },
  },
  {
    name: 'type: integer',
    build: dialect => ddlType(dialect, 'integer'),
    expected: {
      postgres: value('INTEGER'),
      mysql: value('INT'),
      sqlite: value('INTEGER'),
      mssql: value('INT'),
      cockroach: value('INT4'),
      singlestore: value('INT'),
    },
  },
  {
    name: 'type: bigint',
    build: dialect => ddlType(dialect, 'bigint'),
    expected: {
      postgres: value('BIGINT'),
      mysql: value('BIGINT'),
      sqlite: value('INTEGER'),
      mssql: value('BIGINT'),
      cockroach: value('BIGINT'),
      singlestore: value('BIGINT'),
    },
  },
  {
    name: 'type: numeric',
    build: dialect => ddlType(dialect, 'numeric'),
    expected: {
      postgres: value('NUMERIC'),
      mysql: value('DECIMAL'),
      sqlite: value('NUMERIC'),
      mssql: value('DECIMAL'),
      cockroach: value('NUMERIC'),
      singlestore: value('DECIMAL'),
    },
  },
  {
    name: 'type: text',
    build: dialect => ddlType(dialect, 'text'),
    expected: {
      postgres: value('TEXT'),
      mysql: value('TEXT'),
      sqlite: value('TEXT'),
      mssql: value('NVARCHAR(MAX)'),
      cockroach: value('TEXT'),
      singlestore: value('TEXT'),
    },
  },
  {
    name: 'type: varchar',
    build: dialect => ddlType(dialect, 'varchar'),
    expected: {
      postgres: value('VARCHAR'),
      mysql: value('TEXT'),
      sqlite: value('TEXT'),
      mssql: value('NVARCHAR(MAX)'),
      cockroach: value('VARCHAR'),
      singlestore: value('TEXT'),
    },
  },
  {
    name: 'type: boolean',
    build: dialect => ddlType(dialect, 'boolean'),
    expected: {
      postgres: value('BOOLEAN'),
      mysql: value('TINYINT(1)'),
      sqlite: value('INTEGER'),
      mssql: value('BIT'),
      cockroach: value('BOOLEAN'),
      singlestore: value('TINYINT(1)'),
    },
  },
  {
    name: 'type: timestamp',
    build: dialect => ddlType(dialect, 'timestamp'),
    expected: {
      postgres: value('TIMESTAMPTZ'),
      mysql: value('DATETIME(3)'),
      sqlite: value('TEXT'),
      mssql: value('DATETIMEOFFSET(3)'),
      cockroach: value('TIMESTAMPTZ'),
      singlestore: value('DATETIME(3)'),
    },
  },
  {
    name: 'type: json',
    build: dialect => ddlType(dialect, 'json'),
    expected: {
      postgres: value('JSONB'),
      mysql: value('JSON'),
      sqlite: value('TEXT'),
      mssql: value('NVARCHAR(MAX)'),
      cockroach: value('JSONB'),
      singlestore: value('JSON'),
    },
  },
  {
    name: 'type: jsonEnum',
    build: dialect => ddlType(dialect, 'jsonEnum'),
    expected: {
      postgres: value('TEXT'),
      mysql: value('TEXT'),
      sqlite: value('TEXT'),
      mssql: value('NVARCHAR(MAX)'),
      cockroach: value('TEXT'),
      singlestore: value('TEXT'),
    },
  },
  {
    name: 'change op: create_table',
    build: dialect => emitUp(createEvents, dialect),
    expected: {
      postgres: value('CREATE TABLE "events" ("id" SERIAL PRIMARY KEY)'),
      mysql: value('CREATE TABLE `events` (`id` INT AUTO_INCREMENT PRIMARY KEY)'),
      sqlite: value('CREATE TABLE "events" ("id" INTEGER PRIMARY KEY)'),
      mssql: value('CREATE TABLE [events] ([id] INT IDENTITY(1,1) PRIMARY KEY)'),
      cockroach: value('CREATE TABLE "events" ("id" INT8 DEFAULT unique_rowid() PRIMARY KEY)'),
      singlestore: value(
        'CREATE TABLE `events` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY, SHARD KEY (`id`), SORT KEY (`id`))',
      ),
    },
  },
  {
    name: 'change op: drop_table',
    build: dialect => emitUp({ kind: 'drop_table', table: 'events' }, dialect),
    expected: {
      postgres: value('DROP TABLE "events"'),
      mysql: value('DROP TABLE `events`'),
      sqlite: value('DROP TABLE "events"'),
      mssql: value('DROP TABLE [events]'),
      cockroach: value('DROP TABLE "events"'),
      singlestore: value('DROP TABLE `events`'),
    },
  },
  {
    name: 'change op: add_column',
    build: dialect =>
      emitUp(
        {
          kind: 'add_column',
          table: 'users',
          column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
        },
        dialect,
      ),
    expected: {
      postgres: value('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL'),
      mysql: value('ALTER TABLE `users` ADD COLUMN `age` INT NOT NULL'),
      sqlite: value('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL'),
      mssql: value('ALTER TABLE [users] ADD [age] INT NOT NULL'),
      cockroach: value('ALTER TABLE "users" ADD COLUMN "age" INT4 NOT NULL'),
      singlestore: value('ALTER TABLE `users` ADD COLUMN `age` INT NOT NULL'),
    },
  },
  {
    name: 'change op: drop_column',
    build: dialect => emitUp({ kind: 'drop_column', table: 'users', column: 'age' }, dialect),
    expected: {
      postgres: value('ALTER TABLE "users" DROP COLUMN "age"'),
      mysql: value('ALTER TABLE `users` DROP COLUMN `age`'),
      sqlite: value('ALTER TABLE "users" DROP COLUMN "age"'),
      mssql: value('ALTER TABLE [users] DROP COLUMN [age]'),
      cockroach: value('ALTER TABLE "users" DROP COLUMN "age"'),
      singlestore: value('ALTER TABLE `users` DROP COLUMN `age`'),
    },
  },
  {
    name: 'change op: alter_column_type',
    build: dialect =>
      emitUp({ kind: 'alter_column_type', table: 'events', column: 'at', from: 'text', to: 'timestamp' }, dialect),
    expected: {
      postgres: value('ALTER TABLE "events" ALTER COLUMN "at" TYPE TIMESTAMPTZ'),
      mysql: value('ALTER TABLE `events` MODIFY COLUMN `at` DATETIME(3)'),
      sqlite: refused('alter column type', 'sqlite'),
      mssql: value('ALTER TABLE [events] ALTER COLUMN [at] DATETIMEOFFSET(3)'),
      cockroach: value('ALTER TABLE "events" ALTER COLUMN "at" TYPE TIMESTAMPTZ'),
      singlestore: value('ALTER TABLE `events` MODIFY COLUMN `at` DATETIME(3)'),
    },
  },
];

const EXPECTED_CONSTRUCTS: readonly [
  'select: where + order + limit',
  'select: chained predicates',
  'insert: returning',
  'update: set + where',
  'delete: where',
  'pagination: offset only',
  'pagination: unordered limit',
  'upsert: update',
  'set operation: placeholder continuation',
  'vector operator: l2',
  'vector operator: cosine',
  'vector operator: inner product',
  'spatial predicate: contains',
  'spatial predicate: within',
  'spatial predicate: intersects',
  'spatial predicate: within distance',
  'write expression: increment',
  'write expression: decrement',
  'write expression: multiply',
  'write expression: boolean not',
  'write expression: concatenate',
  'write expression: coalesce',
  'null predicate: is null',
  'null predicate: is not null',
  'cursor-safe select text',
  'full-text search',
  'type: serial',
  'type: integer',
  'type: bigint',
  'type: numeric',
  'type: text',
  'type: varchar',
  'type: boolean',
  'type: timestamp',
  'type: json',
  'type: jsonEnum',
  'change op: create_table',
  'change op: drop_table',
  'change op: add_column',
  'change op: drop_column',
  'change op: alter_column_type',
] = [
  'select: where + order + limit',
  'select: chained predicates',
  'insert: returning',
  'update: set + where',
  'delete: where',
  'pagination: offset only',
  'pagination: unordered limit',
  'upsert: update',
  'set operation: placeholder continuation',
  'vector operator: l2',
  'vector operator: cosine',
  'vector operator: inner product',
  'spatial predicate: contains',
  'spatial predicate: within',
  'spatial predicate: intersects',
  'spatial predicate: within distance',
  'write expression: increment',
  'write expression: decrement',
  'write expression: multiply',
  'write expression: boolean not',
  'write expression: concatenate',
  'write expression: coalesce',
  'null predicate: is null',
  'null predicate: is not null',
  'cursor-safe select text',
  'full-text search',
  'type: serial',
  'type: integer',
  'type: bigint',
  'type: numeric',
  'type: text',
  'type: varchar',
  'type: boolean',
  'type: timestamp',
  'type: json',
  'type: jsonEnum',
  'change op: create_table',
  'change op: drop_table',
  'change op: add_column',
  'change op: drop_column',
  'change op: alter_column_type',
];

function matrixCase(name: string): MatrixCase {
  const found = MATRIX.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Unknown dialect matrix construct: ${name}`);
  return found;
}

function observedFor(entry: MatrixCase): Readonly<Record<string, Outcome>> {
  const observed: Record<string, Outcome> = {};
  for (const dialect of DIALECTS) observed[dialect] = capture(() => entry.build(dialect));
  return observed;
}

function expectDialect(name: string, dialect: FrozenDialect): void {
  const entry = matrixCase(name);
  expect(capture(() => entry.build(dialect))).toEqual(entry.expected[dialect]);
}

describe('dialect matrix (frozen: dialects/SPEC.md §7)', () => {
  it('covers every construct for every dialect', () => {
    expect(MATRIX.map(entry => entry.name)).toEqual(EXPECTED_CONSTRUCTS);
    expect(new Set(MATRIX.map(entry => entry.name)).size).toBe(MATRIX.length);
    expect(SQL_TYPES).toHaveLength(10);
    for (const entry of MATRIX) expect(Object.keys(entry.expected)).toEqual(DIALECTS);
  });

  // Green control: the freeze adds no refactor and preserves the existing goldens.
  it('preserves the shipped postgres, mysql and sqlite golden rows', () => {
    for (const name of [
      'select: where + order + limit',
      'select: chained predicates',
      'update: set + where',
      'delete: where',
      'cursor-safe select text',
    ]) {
      for (const dialect of SHIPPED_DIALECTS) expectDialect(name, dialect);
    }
  });

  for (const entry of MATRIX) {
    it.fails(`matches ${entry.name} across all six dialects`, () => {
      expect(observedFor(entry)).toEqual(entry.expected);
    });
  }

  // Literal titles from the tracker remain visible to static coverage tooling.
  it.fails('emits @pN placeholders and bracket-quoted identifiers on mssql', () => {
    expectDialect('select: where + order + limit', 'mssql');
  });

  it.fails('escapes a closing bracket in an mssql identifier', () => {
    expect(quoteIdentifier('mssql', 'weird]name')).toBe('[weird]]name]');
  });

  it.fails('paginates with OFFSET/FETCH on mssql', () => {
    expectDialect('select: where + order + limit', 'mssql');
    expectDialect('pagination: offset only', 'mssql');
  });

  it.fails('refuses or adds an ORDER BY for a paginated query without one', () => {
    expectDialect('pagination: unordered limit', 'mssql');
  });

  it.fails('emits OUTPUT INSERTED for a returning insert on mssql', () => {
    expectDialect('insert: returning', 'mssql');
  });

  it.fails('emits MERGE for an upsert on mssql', () => {
    expectDialect('upsert: update', 'mssql');
  });

  it.fails('maps every SqlType to an mssql type', () => {
    const actual: Record<string, Outcome> = {};
    const expected: Record<string, Outcome> = {};
    for (const type of SQL_TYPES) {
      const entry = matrixCase(`type: ${type}`);
      actual[type] = capture(() => entry.build('mssql'));
      expected[type] = entry.expected.mssql;
    }
    expect(actual).toEqual(expected);
  });

  it.fails('emits IDENTITY(1,1) for a serial column on mssql', () => {
    expectDialect('type: serial', 'mssql');
  });

  // The live tracker still says UUID. Accepted SPEC §4.1 rejects that because
  // Entity<Serial> is a number; this is the corrected executable claim.
  it.fails('maps serial to INT8 DEFAULT unique_rowid() on cockroach', () => {
    expectDialect('type: serial', 'cockroach');
  });

  it.fails('emits a shard key on singlestore', () => {
    expectDialect('change op: create_table', 'singlestore');
  });

  // SingleStore columnstore is the default. The explicit alternative is ROWSTORE;
  // there is no truthful COLUMNSTORE keyword to freeze.
  it.fails('emits CREATE ROWSTORE TABLE when singlestore rowstore is declared', () => {
    const rowstore: FrozenCreateTable = {
      kind: 'create_table',
      table: 'sessions',
      columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
      tableOptions: { rowstore: true },
    };
    expect(capture(() => emitUp(rowstore, 'singlestore'))).toEqual(
      value('CREATE ROWSTORE TABLE `sessions` (`id` BIGINT PRIMARY KEY)'),
    );
  });

  it.fails('uses the default columnstore form when a singlestore sort key is declared', () => {
    expectDialect('change op: create_table', 'singlestore');
  });

  it.fails('inherits postgres behaviour on cockroach where it does not diverge', () => {
    const postgres = capture(() => matrixCase('update: set + where').build('postgres'));
    const cockroach = capture(() => matrixCase('update: set + where').build('cockroach'));
    expect(cockroach).toEqual(postgres);
  });

  it.fails('refuses an unsupported construct with a message naming the dialect', () => {
    expectDialect('full-text search', 'mssql');
    expectDialect('full-text search', 'cockroach');
    expectDialect('insert: returning', 'singlestore');
  });
});
