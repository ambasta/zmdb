import { DatabaseSync } from 'node:sqlite';

import type { CompiledQuery } from '@zmdb/query-compiler';
import {
  BaseRepository,
  createLoaderScope,
  memoryStore,
  type Driver,
  type FilterDef,
  type QueryMeta,
} from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import type { ColumnIR, SchemaIR } from '@zmdb/schema-core/ir';
import { schemaFromIR } from '@zmdb/schema-core/ir';
import type { OneToMany, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

export interface FilterUser extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: number & Sql<'integer'>;
  role: string & Sql<'text'>;
  active: boolean & Sql<'boolean'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
  posts?: FilterPost[] & OneToMany<'posts', 'userId'>;
}

export interface FilterPost extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  tenantId: number & Sql<'integer'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}

function column(name: string, sql: ColumnIR['sql'], overrides: Partial<ColumnIR> = {}): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...overrides,
  };
}

const USER_IR: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [
    column('id', 'integer', { primaryKey: true, serial: true }),
    column('tenantId', 'integer'),
    column('role', 'text'),
    column('active', 'boolean'),
    column('deletedAt', 'timestamp', { nullable: true }),
  ],
  primaryKey: ['id'],
  relations: [{ name: 'posts', relation: 'oneToMany', target: 'posts', via: 'userId' }],
  foreignKeys: [],
};

const UserSchema = schemaFromIR(USER_IR);
const PostSchema = schemaFromIR({
  table: 'posts',
  physicalTable: 'posts',
  columns: [
    column('id', 'integer', { primaryKey: true, serial: true }),
    column('userId', 'integer'),
    column('tenantId', 'integer'),
    column('deletedAt', 'timestamp', { nullable: true }),
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
} satisfies SchemaIR);
const OrganizationSchema = schemaFromIR({
  table: 'organizations',
  physicalTable: 'organizations',
  columns: [column('id', 'integer', { primaryKey: true }), column('tenantId', 'integer')],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
} satisfies SchemaIR);

const activeFilter = {
  name: 'active',
  where: (_params: void) => [{ col: 'active', op: '=', value: true }] as const,
} as const satisfies FilterDef;

const tenantFilter = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

const activeOrAdminFilter = {
  name: 'activeOrAdmin',
  where: (_params: void) =>
    [
      { col: 'active', op: '=', value: true },
      { col: 'role', op: '=', value: 'admin', connector: 'OR' },
    ] as const,
} as const satisfies FilterDef;

const visibleFilter = {
  name: 'visible',
  where: (_params: void) => [{ col: 'active', op: '=', value: true }] as const,
} as const satisfies FilterDef;

class ActiveUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [activeFilter] as const;
}

class TenantUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [tenantFilter] as const;
}

class TenantAndActiveUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [tenantFilter, activeFilter] as const;
}

class PlainUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
}

class ActiveOrAdminUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [activeOrAdminFilter] as const;
}

class VisibleUsers extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [visibleFilter] as const;
}

const postVisibilityFilter = {
  name: 'postVisibility',
  table: 'posts',
  schema: PostSchema,
  where: (_params: void) => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;

const organizationTenantFilter = {
  name: 'organizationTenant',
  table: 'organizations',
  schema: OrganizationSchema,
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

const postTenantFilter = {
  name: 'postTenant',
  table: 'posts',
  schema: PostSchema,
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

class UsersWithTargetFilters extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [activeFilter, postVisibilityFilter, organizationTenantFilter] as const;
}

class UsersWithParameterizedPostFilter extends BaseRepository<FilterUser> {
  static override readonly schema = UserSchema;
  static readonly filters = [postTenantFilter] as const;
}

interface RecordingDriver extends Driver {
  readonly calls: CompiledQuery[];
}

function recordingDriver(rows: readonly Record<string, unknown>[] = []): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    calls,
    execute: query => {
      calls.push(query);
      return Promise.resolve(rows);
    },
  };
}

function statements(calls: readonly CompiledQuery[]): readonly { text: string; parameters: readonly unknown[] }[] {
  return calls.map(({ text, parameters }) => ({ text, parameters }));
}

describe('declared repository filters', () => {
  it('applies a declared filter to every single-table read', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.findById(7);
    await repo.findOne({ role: 'admin' });
    await repo.find({ role: 'admin' });
    await repo.findAll();
    await repo.list({ page: { limit: 2, offset: 0 } });
    await repo.count();
    await repo.exists();

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "id" = $1 AND "active" = $2 LIMIT 1',
        parameters: [7, true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2 LIMIT 1',
        parameters: ['admin', true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2',
        parameters: ['admin', true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "active" = $1',
        parameters: [true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "active" = $1 ORDER BY "id" ASC LIMIT 3 OFFSET 0',
        parameters: [true],
      },
      {
        text: 'SELECT COUNT(*) AS "count" FROM "users" WHERE "active" = $1',
        parameters: [true],
      },
      {
        text: 'SELECT "id" FROM "users" WHERE "active" = $1 LIMIT 1',
        parameters: [true],
      },
    ]);
  });

  it('applies a filter to an aggregation and a group-by', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.aggregate(aggregate => aggregate.select(['role']).count('id', 'n').groupBy('role'));

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT "role", COUNT("id") AS "n" FROM "users" WHERE "active" = $1 GROUP BY "role"',
        parameters: [true],
      },
    ]);
  });

  // The keyed write surface exists today, so its complete SQL can be frozen even
  // though the live issue names only the not-yet-declared bulk variants.
  // Actual at 9e6b9757: both statements end after their primary-key predicate.
  it.fails('applies a write filter to update and delete', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.update(7, { role: 'user' });
    await repo.delete(7);

    expect(statements(driver.calls)).toEqual([
      {
        text: 'UPDATE "users" SET "role" = $1 WHERE "id" = $2 AND "active" = $3 RETURNING *',
        parameters: ['user', 7, true],
      },
      {
        text: 'DELETE FROM "users" WHERE "id" = $1 AND "active" = $2 RETURNING "id"',
        parameters: [7, true],
      },
    ]);
  });

  // Actual at 9e6b9757: both properties are undefined. Neither the frozen SPEC nor
  // #451 supplies a callable signature, so this title intentionally freezes only
  // their required existence; full SQL remains an explicit blocker in DOD.md.
  it.fails('applies a write filter to updateMany and deleteMany', () => {
    const repo = new ActiveUsers(recordingDriver());
    expect(Reflect.get(repo, 'updateMany')).toBeTypeOf('function');
    expect(Reflect.get(repo, 'deleteMany')).toBeTypeOf('function');
  });

  it('throws when a parameterised filter is called without its parameter, naming the filter', async () => {
    const driver = recordingDriver();
    const repo = new TenantUsers(driver);

    await expect(repo.findAll()).rejects.toThrow(
      'filter `tenant` requires parameters (tenantId) and none were supplied; pass them per call — ' +
        'findAll({ filters: { tenant: { tenantId } } }) — or disable it by name',
    );
    expect(driver.calls).toEqual([]);
  });

  it('disables one named filter for one call and leaves the others applied', async () => {
    const driver = recordingDriver();
    const repo = new TenantAndActiveUsers(driver);
    await repo.findAll({ filters: { tenant: { tenantId: 42 }, active: false } });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "tenantId" = $1',
        parameters: [42],
      },
    ]);
  });

  it('conjoins an OR filter as one predicate group', async () => {
    const driver = recordingDriver();
    const repo = new ActiveOrAdminUsers(driver);

    await repo.find({ tenantId: 42 });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "tenantId" = $1 AND ("active" = $2 OR "role" = $3)',
        parameters: [42, true, 'admin'],
      },
    ]);
  });

  it('leaves a repository with no declared filters byte-for-byte unchanged', async () => {
    const driver = recordingDriver();
    const repo = new PlainUsers(driver);

    await repo.find({ role: 'admin' });
    await repo.list({ page: { limit: 2, offset: 0 } });

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "role" = $1',
        parameters: ['admin'],
      },
      {
        text: 'SELECT * FROM "users" ORDER BY "id" ASC LIMIT 3 OFFSET 0',
        parameters: [],
      },
    ]);
  });

  it('accepts read filters supplied through RepositoryOptions', async () => {
    const driver = recordingDriver();
    const repo = new PlainUsers(driver, 'postgres', { filters: [activeFilter] });

    await repo.findAll();

    expect(statements(driver.calls)).toEqual([
      {
        text: 'SELECT * FROM "users" WHERE "active" = $1',
        parameters: [true],
      },
    ]);
  });

  it('refuses invalid filter parameters and unknown names before compilation', async () => {
    const driver = recordingDriver();
    const repo = new TenantUsers(driver);

    await expect(repo.findAll({ filters: { tenant: { tenantId: 'not-an-integer' } } })).rejects.toThrow(
      /filters\.tenant\.tenantId/,
    );
    await expect(repo.findAll({ filters: { tenent: false } })).rejects.toThrow(
      'unknown filter `tenent`; declared filters: tenant',
    );
    expect(driver.calls).toEqual([]);
  });

  it('treats null parameters as missing and preserves a parameterless filter error', async () => {
    const tenantDriver = recordingDriver();
    const tenantRepo = new TenantUsers(tenantDriver);

    await expect(tenantRepo.findAll({ filters: { tenant: null } })).rejects.toThrow(
      'filter `tenant` requires parameters (tenantId) and none were supplied',
    );
    expect(tenantDriver.calls).toEqual([]);

    class BrokenUsers extends BaseRepository<FilterUser> {
      static override readonly schema = UserSchema;
      static readonly filters = [
        {
          name: 'broken',
          where: (_params: void) => {
            throw new Error('filter callback failed');
          },
        },
      ] as const satisfies readonly FilterDef[];
    }

    const brokenDriver = recordingDriver();
    await expect(new BrokenUsers(brokenDriver).findAll()).rejects.toThrow('filter callback failed');
    expect(brokenDriver.calls).toEqual([]);
  });

  it('rejects a target-only override on a single-table read', async () => {
    const driver = recordingDriver();
    const repo = new UsersWithTargetFilters(driver);

    await expect(repo.findAll({ filters: { organizationTenant: { tenantId: 42 } } })).rejects.toThrow(
      'unknown filter `organizationTenant`; declared filters: active',
    );
    expect(driver.calls).toEqual([]);
  });

  it('refuses a missing target-filter parameter before compiling the parent read', async () => {
    const driver = recordingDriver([{ id: 1, tenantId: 42, role: 'admin', active: true, deletedAt: null }]);
    const repo = new UsersWithParameterizedPostFilter(driver);

    await expect(repo.findById(1, { populate: ['posts'] })).rejects.toThrow(
      'filter `postTenant` requires parameters (tenantId) and none were supplied; pass them per call — ' +
        'populate({ filters: { postTenant: { tenantId } } }) — or disable it by name',
    );
    expect(driver.calls).toEqual([]);
  });

  it('passes target-filter parameters through findAllWithMany', async () => {
    const calls: CompiledQuery[] = [];
    const driver: Driver = {
      execute(query) {
        calls.push(query);
        return Promise.resolve(
          calls.length === 1 ? [{ id: 1, tenantId: 42, role: 'admin', active: true, deletedAt: null }] : [],
        );
      },
    };
    const repo = new UsersWithParameterizedPostFilter(driver);

    await repo.findAllWithMany('posts', { filters: { postTenant: { tenantId: 42 } } });

    expect(statements(calls)).toEqual([
      { text: 'SELECT * FROM "users"', parameters: [] },
      {
        text: 'SELECT * FROM "posts" WHERE "userId" IN ($1) AND "posts"."tenantId" = $2',
        parameters: [1, 42],
      },
    ]);
  });

  it('reports the final SQL and applied filter names through onQuery', async () => {
    const driver = recordingDriver();
    const observations: { readonly query: CompiledQuery; readonly meta: QueryMeta }[] = [];
    const repo = new ActiveUsers(driver, 'postgres', {
      onQuery(query, meta) {
        observations.push({ query, meta });
      },
    });

    await repo.find({ role: 'admin' });

    expect(observations).toEqual([
      {
        query: {
          text: 'SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2',
          parameters: ['admin', true],
        },
        meta: { filters: ['active'] },
      },
    ]);
  });

  it('includes applied filter names in result-cache keys', async () => {
    const store = memoryStore();
    const firstDriver = recordingDriver([{ id: 1, tenantId: 42, role: 'admin', active: true, deletedAt: null }]);
    const secondDriver = recordingDriver([{ id: 2, tenantId: 42, role: 'user', active: true, deletedAt: null }]);
    const active = new ActiveUsers(firstDriver, 'postgres', { cacheStore: store });
    const visible = new VisibleUsers(secondDriver, 'postgres', { cacheStore: store });

    expect((await active.findAll({ cache: { ttlMs: 1_000 } }))[0]?.id).toBe(1);
    expect((await visible.findAll({ cache: { ttlMs: 1_000 } }))[0]?.id).toBe(2);
    expect(firstDriver.calls).toHaveLength(1);
    expect(secondDriver.calls).toHaveLength(1);
  });

  it('routes every read method through the same filter application', async () => {
    const driver = recordingDriver();
    const repo = new UsersWithTargetFilters(driver);
    const scope = createLoaderScope();

    await repo.findById(1);
    await repo.findOne({});
    await repo.find({ role: 'admin' });
    await repo.findAll();
    await repo.list({ page: { limit: 1, offset: 0 } });
    await repo.count();
    await repo.exists();
    await repo.aggregate(aggregate => aggregate.count('id', 'count'));
    await repo.findByFullText('role', 'admin');
    await repo.findJoined(
      { target: 'organizations', leftCol: 'users.tenantId', rightCol: 'organizations.id' },
      undefined,
      { filters: { organizationTenant: { tenantId: 42 } } },
    );
    await repo.findAllWithMany('posts', 'posts', 'userId');
    await scope.loaderFor(repo).load(1);
    await scope.relationLoader(repo, 'posts').load({
      id: 1,
      tenantId: 42,
      role: 'admin',
      active: true,
      deletedAt: null,
    });

    expect(driver.calls).toHaveLength(13);
    for (const query of driver.calls.slice(0, 12)) expect(query.text).toContain('"active" = $');
    expect(driver.calls[12]?.text).toContain('"posts"."deletedAt" IS NULL');
  });

  it('keeps a filter on every keyset branch', async () => {
    const driver = recordingDriver();
    const repo = new ActiveUsers(driver);

    await repo.list({
      where: { tenantId: 42 },
      orderBy: [{ column: 'role', dir: 'asc' }],
      page: { limit: 2, after: { role: 'admin', id: 7 } },
    });

    expect(statements(driver.calls)).toEqual([
      {
        text:
          'SELECT * FROM "users" WHERE "tenantId" = $1 AND "active" = $2 AND "role" > $3 ' +
          'OR "tenantId" = $4 AND "active" = $5 AND "role" = $6 AND "id" > $7 ' +
          'ORDER BY "role" ASC, "id" ASC LIMIT 3',
        parameters: [42, true, 'admin', 42, true, 'admin', 7],
      },
    ]);
  });

  it('places target filters in JOIN ON and batched populate WHERE clauses', async () => {
    const calls: CompiledQuery[] = [];
    const observedFilters: (readonly string[])[] = [];
    const driver: Driver = {
      execute(query) {
        calls.push(query);
        if (query.text.startsWith('SELECT * FROM "users"')) {
          return Promise.resolve([{ id: 1, tenantId: 42, role: 'admin', active: true, deletedAt: null }]);
        }
        return Promise.resolve([]);
      },
    };
    const repo = new UsersWithTargetFilters(driver, 'postgres', {
      onQuery(_query, meta) {
        observedFilters.push(meta.filters);
      },
    });

    await repo.findJoined(
      { target: 'organizations', leftCol: 'users.tenantId', rightCol: 'organizations.id' },
      undefined,
      { filters: { organizationTenant: { tenantId: 42 } } },
    );
    await repo.findById(1, { populate: ['posts'] });
    await repo.aggregate(aggregate => aggregate.joinRelation('posts', 'left').count('posts.id', 'n'));

    expect(statements(calls)).toEqual([
      {
        text:
          'SELECT * FROM "users" LEFT JOIN "organizations" ' +
          'ON "users"."tenantId" = "organizations"."id" AND "organizations"."tenantId" = $1 ' +
          'WHERE "active" = $2',
        parameters: [42, true],
      },
      {
        text: 'SELECT * FROM "users" WHERE "id" = $1 AND "active" = $2 LIMIT 1',
        parameters: [1, true],
      },
      {
        text: 'SELECT * FROM "posts" WHERE "userId" IN ($1) AND "posts"."deletedAt" IS NULL',
        parameters: [1],
      },
      {
        text:
          'SELECT COUNT("posts"."id") AS "n" FROM "users" LEFT JOIN "posts" ' +
          'ON "users"."id" = "posts"."userId" AND "posts"."deletedAt" IS NULL ' +
          'WHERE "active" = $1',
        parameters: [true],
      },
    ]);
    expect(observedFilters).toEqual([
      ['active', 'organizationTenant'],
      ['active'],
      ['postVisibility'],
      ['active', 'postVisibility'],
    ]);
  });

  it('applies target filters to direct aggregate joins', async () => {
    const driver = recordingDriver();
    const repo = new UsersWithTargetFilters(driver);

    await repo.aggregate(aggregate =>
      aggregate.leftJoin('posts as posts', 'users.id', 'posts.userId').count('posts.id', 'n'),
    );

    expect(statements(driver.calls)).toEqual([
      {
        text:
          'SELECT COUNT("posts"."id") AS "n" FROM "users" LEFT JOIN "posts" AS "posts" ' +
          'ON "users"."id" = "posts"."userId" AND "posts"."deletedAt" IS NULL ' +
          'WHERE "active" = $1',
        parameters: [true],
      },
    ]);
  });
});

const SOFT_DELETE_IR: SchemaIR = {
  ...USER_IR,
  softDelete: { column: 'deletedAt' },
};

const SoftDeleteUserSchema = schemaFromIR(SOFT_DELETE_IR);

class SoftDeleteUsers extends BaseRepository<FilterUser> {
  static override readonly schema = SoftDeleteUserSchema;
}

function recordedSqlite(db: DatabaseSync): { readonly driver: Driver; readonly calls: CompiledQuery[] } {
  const inner = sqliteDriver(db);
  const calls: CompiledQuery[] = [];
  return {
    calls,
    driver: {
      dialect: 'sqlite',
      execute: query => {
        calls.push(query);
        return inner.execute(query);
      },
    },
  };
}

function openSoftDeleteDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE users (' +
      'id INTEGER PRIMARY KEY, tenantId INTEGER NOT NULL, role TEXT NOT NULL, ' +
      'active INTEGER NOT NULL, deletedAt TEXT)',
  );
  return db;
}

describe('soft delete against real SQLite', () => {
  // Actual at 9e6b9757:
  //   DELETE FROM "users" WHERE "id" = ? RETURNING "id"
  //   SELECT * FROM "users" WHERE "id" = ? LIMIT 1
  // and the physical row is gone.
  it.fails('soft-deletes by updating rather than deleting, and hides the row from subsequent reads', async () => {
    const db = openSoftDeleteDatabase();
    try {
      db.exec("INSERT INTO users VALUES (1, 7, 'user', 1, NULL)");
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');

      expect(await repo.delete(1)).toBe(true);
      const hidden = await repo.findById(1);

      expect(calls.map(query => query.text)).toEqual([
        'UPDATE "users" SET "deletedAt" = ? WHERE "id" = ? AND "deletedAt" IS NULL RETURNING "id"',
        'SELECT * FROM "users" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1',
      ]);
      expect(calls[0]?.parameters[0]).toBeInstanceOf(Date);
      expect(calls[0]?.parameters.slice(1)).toEqual([1]);
      expect(calls[1]?.parameters).toEqual([1]);
      expect(db.prepare('SELECT deletedAt FROM users WHERE id = 1').get()).toEqual({
        deletedAt: expect.stringMatching(/^20\d\d-\d\d-\d\dT/),
      });
      expect(hidden).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('reads soft-deleted rows only when the filter is explicitly disabled', async () => {
    const db = openSoftDeleteDatabase();
    try {
      db.exec("INSERT INTO users VALUES (1, 7, 'user', 1, '2026-09-01T00:00:00.000Z')");
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');
      const hidden = await repo.findById(1);
      const visible = await repo.findById(1, { filters: { softDelete: false } });

      expect(statements(calls)).toEqual([
        {
          text: 'SELECT * FROM "users" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1',
          parameters: [1],
        },
        {
          text: 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1',
          parameters: [1],
        },
      ]);
      expect(hidden).toBeUndefined();
      expect(visible).toMatchObject({ id: 1, tenantId: 7, role: 'user', active: 1 });
      expect(visible?.deletedAt).toBeInstanceOf(Date);
    } finally {
      db.close();
    }
  });

  // The first three rows are deleted and the next twelve are live. Filtering in
  // SQL returns ten live rows; LIMIT-before-post-filtering can return only seven.
  it('applies a filter before LIMIT rather than post-filtering rows', async () => {
    const db = openSoftDeleteDatabase();
    try {
      const insert = db.prepare('INSERT INTO users VALUES (?, 7, ?, 1, ?)');
      for (let id = 1; id <= 15; id++) {
        insert.run(id, `user-${id}`, id <= 3 ? '2026-09-01T00:00:00.000Z' : null);
      }
      const { driver, calls } = recordedSqlite(db);
      const repo = new SoftDeleteUsers(driver, 'sqlite');

      const result = await repo.list({ page: { limit: 10, offset: 0 } });

      expect(statements(calls)).toEqual([
        {
          text: 'SELECT * FROM "users" WHERE "deletedAt" IS NULL ORDER BY "id" ASC LIMIT 11 OFFSET 0',
          parameters: [],
        },
      ]);
      expect(result.items.map(row => row.id)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      expect(result.hasMore).toBe(true);
    } finally {
      db.close();
    }
  });
});
