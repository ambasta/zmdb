import type { CompiledQuery } from '@zmdb/query-compiler';
import type { CreateDTO } from '@zmdb/schema-core';
import { schemaFromIR, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { OneToMany, PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, type Driver, type FilterDef } from './index.js';
import { postgresDialect } from './testing/official-dialects.fixture.js';

interface NamedUser extends Table<'userAccount'> {
  id: number & Sql<'integer'> & PrimaryKey;
  displayName: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'>;
  posts?: NamedPost[] & OneToMany<'blogPost', 'userId'>;
}

interface NamedPost extends Table<'blogPost'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'>;
  title: string & Sql<'text'>;
}

interface NamedTenantUser extends Table<'tenantAccount'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  id: number & Sql<'integer'> & PrimaryKey;
  displayName: string & Sql<'text'>;
  posts?: NamedTenantPost[] & OneToMany<'tenantPost', 'tenantId,userId'>;
}

interface NamedTenantPost extends Table<'tenantPost'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: string & Sql<'text'>;
  userId: number & Sql<'integer'>;
  title: string & Sql<'text'>;
}

function column(name: string, physicalName: string, sql: ColumnIR['sql'], primaryKey = false): ColumnIR {
  return {
    name,
    physicalName,
    sql,
    nullable: false,
    primaryKey,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
  };
}

const namedUserIr = {
  table: 'userAccount',
  physicalTable: 'user_accounts',
  columns: [
    column('id', 'account_id', 'integer', true),
    column('displayName', 'display_name', 'text'),
    column('createdAt', 'created_at', 'timestamp'),
  ],
  primaryKey: ['id'],
  relations: [{ name: 'posts', relation: 'oneToMany', target: 'blogPost', via: 'userId' }],
  foreignKeys: [],
} satisfies SchemaIR;

const NamedUserSchema = schemaFromIR(namedUserIr);
const NamedPostSchema = schemaFromIR({
  table: 'blogPost',
  physicalTable: 'blog_posts',
  columns: [
    column('id', 'post_id', 'integer', true),
    column('userId', 'user_id', 'integer'),
    column('title', 'post_title', 'text'),
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
} satisfies SchemaIR);

const NamedTenantUserSchema = schemaFromIR({
  table: 'tenantAccount',
  physicalTable: 'tenant_accounts',
  columns: [
    column('tenantId', 'tenant_key', 'text', true),
    column('id', 'account_key', 'integer', true),
    column('displayName', 'display_name', 'text'),
  ],
  primaryKey: ['tenantId', 'id'],
  relations: [{ name: 'posts', relation: 'oneToMany', target: 'tenantPost', via: 'tenantId,userId' }],
  foreignKeys: [],
} satisfies SchemaIR);

const NamedTenantPostSchema = schemaFromIR({
  table: 'tenantPost',
  physicalTable: 'tenant_posts',
  columns: [
    column('id', 'post_id', 'integer', true),
    column('tenantId', 'tenant_fk', 'text'),
    column('userId', 'author_fk', 'integer'),
    column('title', 'post_title', 'text'),
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
} satisfies SchemaIR);

const displayNameFilter = {
  name: 'displayName',
  where: ({ value }: { readonly value: string }) => [{ col: 'displayName', op: '=', value }] as const,
} as const satisfies FilterDef<{ readonly value: string }>;

class NamedUsers extends BaseRepository<NamedUser> {
  static override readonly schema = NamedUserSchema;
}

class NamedPosts extends BaseRepository<NamedPost> {
  static override readonly schema = NamedPostSchema;
}

class NamedTenantUsers extends BaseRepository<NamedTenantUser> {
  static override readonly schema = NamedTenantUserSchema;
}

class FilteredNamedUsers extends BaseRepository<NamedUser> {
  static override readonly schema = NamedUserSchema;
  static readonly filters = [displayNameFilter] as const;
}

interface RecordingDriver extends Driver {
  readonly calls: CompiledQuery[];
}

function recordingDriver(rows: readonly Record<string, unknown>[] = []): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    dialect: postgresDialect,
    calls,
    execute(query) {
      calls.push(query);
      return Promise.resolve(rows);
    },
  };
}

function sequenceDriver(results: readonly (readonly Record<string, unknown>[])[]): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    dialect: postgresDialect,
    calls,
    execute(query) {
      calls.push(query);
      return Promise.resolve(results[calls.length - 1] ?? []);
    },
  };
}

describe('repository physical-name boundary (frozen: schema-core/ir/SPEC.md §4.2)', () => {
  it('filters with physical names', async () => {
    const driver = recordingDriver();
    await new FilteredNamedUsers(driver).findAll({ filters: { displayName: { value: 'Ada' } } });

    expect(driver.calls).toEqual([
      {
        text:
          'SELECT "account_id" AS "id", "display_name" AS "displayName", ' +
          '"created_at" AS "createdAt" FROM "user_accounts" WHERE "display_name" = $1',
        parameters: ['Ada'],
        operation: 'select',
        isWrite: false,
        returnsRows: true,
      },
    ]);
  });

  it('orders with physical names', async () => {
    const driver = recordingDriver();
    await new NamedUsers(driver).list({
      orderBy: [{ column: 'createdAt', dir: 'desc' }],
      page: { limit: 2, offset: 0 },
    });

    expect(driver.calls[0]).toEqual({
      text:
        'SELECT "account_id" AS "id", "display_name" AS "displayName", ' +
        '"created_at" AS "createdAt" FROM "user_accounts" ' +
        'ORDER BY "created_at" DESC, "account_id" ASC LIMIT 3 OFFSET 0',
      parameters: [],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('projects with physical names while keeping cursor columns in the result set', async () => {
    const driver = recordingDriver();
    await new NamedUsers(driver).list({
      select: ['displayName'],
      page: { limit: 1 },
    });

    expect(driver.calls[0]).toEqual({
      text:
        'SELECT "display_name" AS "displayName", "account_id" AS "id" FROM "user_accounts" ' +
        'ORDER BY "account_id" ASC LIMIT 2',
      parameters: [],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('groups with physical names', async () => {
    const driver = recordingDriver();
    await new NamedUsers(driver).aggregate({
      groupBy: ['createdAt'],
      computed: { count: { fn: 'count', column: 'id' } },
      orderBy: [{ column: 'createdAt' }],
    });

    expect(driver.calls[0]).toEqual({
      text:
        'SELECT "created_at" AS "createdAt", COUNT("account_id") AS "count" ' +
        'FROM "user_accounts" GROUP BY "created_at" ORDER BY "created_at" ASC',
      parameters: [],
      operation: 'select',
      isWrite: false,
      returnsRows: true,
    });
  });

  it('writes physical names and aliases returned rows to property names', async () => {
    const returned = { id: 7, displayName: 'Ada', createdAt: new Date('2026-01-01T00:00:00.000Z') };
    const driver = recordingDriver([returned]);
    const users = new NamedUsers(driver);

    await users.create({
      id: 7,
      displayName: 'Ada',
      createdAt: returned.createdAt,
    } satisfies CreateDTO<NamedUser>);
    await users.update(7, { displayName: 'Grace' });

    expect(driver.calls).toEqual([
      {
        text:
          'INSERT INTO "user_accounts" ("account_id", "display_name", "created_at") VALUES ($1, $2, $3) ' +
          'RETURNING "account_id" AS "id", "display_name" AS "displayName", "created_at" AS "createdAt"',
        parameters: [7, 'Ada', returned.createdAt],
        operation: 'insert',
        isWrite: true,
        returnsRows: true,
      },
      {
        text:
          'UPDATE "user_accounts" SET "display_name" = $1 WHERE "account_id" = $2 ' +
          'RETURNING "account_id" AS "id", "display_name" AS "displayName", "created_at" AS "createdAt"',
        parameters: ['Grace', 7],
        operation: 'update',
        isWrite: true,
        returnsRows: true,
      },
    ]);
  });

  it('does not rewrite a raw SQL fragment', async () => {
    const driver = recordingDriver();
    const raw = `date_trunc('day', created_at)`;
    await new NamedUsers(driver).aggregate(aggregate => aggregate.expr(raw, 'bucket').count('id', 'count'));

    expect(driver.calls[0]?.text).toBe(
      `SELECT ${raw} AS "bucket", COUNT("account_id") AS "count" FROM "user_accounts"`,
    );
  });

  it('returns aliased driver rows without a per-row naming rewrite', async () => {
    const row = { id: 11, userId: 7, title: 'Physical names' };
    const driver = recordingDriver([row]);

    const result = await new NamedPosts(driver).findAll();

    expect(result[0]).toBe(row);
    expect(driver.calls[0]?.text).toBe(
      'SELECT "post_id" AS "id", "user_id" AS "userId", "post_title" AS "title" FROM "blog_posts"',
    );
  });

  it('resolves populated target tables and columns from the constructor schema set', async () => {
    const driver = sequenceDriver([
      [{ id: 7, displayName: 'Ada', createdAt: new Date('2026-01-01T00:00:00.000Z') }],
      [{ id: 11, userId: 7, title: 'Physical names' }],
    ]);
    const users = new NamedUsers(driver, postgresDialect, { schemas: [NamedPostSchema] });

    await users.findAll({ populate: ['posts'] });

    expect(driver.calls.map(query => query.text)).toEqual([
      'SELECT "account_id" AS "id", "display_name" AS "displayName", "created_at" AS "createdAt" FROM "user_accounts"',
      'SELECT "post_id" AS "id", "user_id" AS "userId", "post_title" AS "title" ' +
        'FROM "blog_posts" WHERE "user_id" IN ($1)',
    ]);
  });

  it('populates composite relations with every physical key and declared result keys', async () => {
    const parents = [
      { tenantId: 't1', id: 7, displayName: 'Ada' },
      { tenantId: 't2', id: 7, displayName: 'Grace' },
    ];
    const children = [
      { id: 11, tenantId: 't1', userId: 7, title: 'First tenant' },
      { id: 12, tenantId: 't2', userId: 7, title: 'Second tenant' },
    ];
    const driver = sequenceDriver([parents, children]);
    const users = new NamedTenantUsers(driver, postgresDialect, { schemas: [NamedTenantPostSchema] });

    const populated = await users.findAll({ populate: ['posts'] });

    expect(driver.calls.map(query => query.text)).toEqual([
      'SELECT "tenant_key" AS "tenantId", "account_key" AS "id", "display_name" AS "displayName" ' +
        'FROM "tenant_accounts"',
      'SELECT "post_id" AS "id", "tenant_fk" AS "tenantId", "author_fk" AS "userId", ' +
        '"post_title" AS "title" FROM "tenant_posts" WHERE ' +
        '("tenant_fk" = $1 AND "author_fk" = $2 OR "tenant_fk" = $3 AND "author_fk" = $4)',
    ]);
    expect(driver.calls[1]?.parameters).toEqual(['t1', 7, 't2', 7]);
    expect(populated.map(parent => parent.posts.map(post => post.title))).toEqual([
      ['First tenant'],
      ['Second tenant'],
    ]);
  });

  it('joins composite relations with every physical key pair', async () => {
    const driver = recordingDriver([{ count: 2 }]);
    const users = new NamedTenantUsers(driver, postgresDialect, { schemas: [NamedTenantPostSchema] });

    await users.aggregate(aggregate => aggregate.joinRelation('posts').count('id', 'count'));

    expect(driver.calls[0]?.text).toBe(
      'SELECT COUNT("account_key") AS "count" FROM "tenant_accounts" ' +
        'INNER JOIN "tenant_posts" AS "posts" ' +
        'ON "tenant_accounts"."tenant_key" = "posts"."tenant_fk" ' +
        'AND "tenant_accounts"."account_key" = "posts"."author_fk"',
    );
  });
});
