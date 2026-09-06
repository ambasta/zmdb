import { schemasFrom } from '@zmdb/compiler/testing';
import {
  getSchemaFilterWhere,
  normalizeSoftDeleteConfig,
  normalizeGlobalFilters,
  type CoreSchema,
} from '@zmdb/schema-core';
import type { OneToMany, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { BaseRepository, type Driver, type FilterDef } from './index.js';
import { postgresDialect } from './testing/official-dialects.fixture.js';

// Mock driver recording compiled queries and returning configurable rows
function createMockDriver(mockRows: Record<string, unknown>[] = []): {
  driver: Driver;
  queries: { text: string; parameters: readonly unknown[] }[];
} {
  const queries: { text: string; parameters: readonly unknown[] }[] = [];
  const driver: Driver = {
    dialect: postgresDialect,
    async execute(query) {
      queries.push({ text: query.text, parameters: query.parameters });
      return mockRows;
    },
  };
  return { driver, queries };
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  deletedAt?: Date & Sql<'timestamp'>;
  tenantId: number & Sql<'integer'>;
}

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  isDeleted: boolean & Sql<'boolean'>;
}

export interface Category extends Table<'categories'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
}

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  comments?: Comment[] & OneToMany<'comments', 'userId'>;
}

export interface Comment extends Table<'comments'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'>;
  content: string & Sql<'text'>;
  deletedAt?: Date & Sql<'timestamp'>;
}

const {
  Post: rawPostSchema,
  Article: rawArticleSchema,
  Category: CategorySchema,
  User: UserSchema,
  Comment: rawCommentSchema,
} = schemasFrom<{
  Post: Post;
  Article: Article;
  Category: Category;
  User: User;
  Comment: Comment;
}>(import.meta.url, ['Post', 'Article', 'Category', 'User', 'Comment']);

const softDeleteSchema: CoreSchema = {
  ...rawPostSchema,
  softDelete: normalizeSoftDeleteConfig(true),
  globalFilters: normalizeGlobalFilters({
    tenant: (ctx: unknown) => ({ tenantId: (ctx as { tenantId?: number })?.tenantId ?? 1 }),
    status: { title: { ne: 'banned' } },
  }),
};

const postSoftDeleteFilter = {
  name: 'softDelete',
  where: (_params: void) => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;

const postTenantFilter = {
  name: 'tenant',
  where: () => [{ col: 'tenantId', op: '=', value: 1 }] as const,
} as const satisfies FilterDef;

const paramTenantFilter = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

const postStatusFilter = {
  name: 'status',
  where: () => [{ col: 'title', op: '!=', value: 'banned' }] as const,
} as const satisfies FilterDef;

const articleSoftDeleteFilter = {
  name: 'softDelete',
  where: () => [{ col: 'isDeleted', op: '=', value: false }] as const,
} as const satisfies FilterDef;

const commentSoftDeleteFilter = {
  name: 'softDelete',
  table: 'comments',
  schema: rawCommentSchema,
  where: () => [{ col: 'deletedAt', op: 'is null', value: undefined }] as const,
} as const satisfies FilterDef;

const sd = normalizeSoftDeleteConfig({
  column: 'isDeleted',
  deletedValue: true,
  activeValue: false,
});

const customSoftDeleteSchema: CoreSchema = {
  ...rawArticleSchema,
  ...(sd !== undefined ? { softDelete: sd } : {}),
  ir: {
    ...rawArticleSchema.ir,
    ...(sd !== undefined ? { softDelete: sd } : {}),
  },
};

class PostRepository extends BaseRepository<Post> {
  static override readonly schema = softDeleteSchema;
  static readonly filters = [postSoftDeleteFilter, postTenantFilter, postStatusFilter] as const;
}

class ParamPostRepository extends BaseRepository<Post> {
  static override readonly schema = softDeleteSchema;
  static readonly filters = [postSoftDeleteFilter, paramTenantFilter, postStatusFilter] as const;
}

class CustomArticleRepository extends BaseRepository<Article> {
  static override readonly schema = customSoftDeleteSchema;
  static readonly filters = [articleSoftDeleteFilter] as const;
}

class CategoryRepository extends BaseRepository<Category> {
  static override readonly schema = CategorySchema;
}

class CommentRepository extends BaseRepository<Comment> {
  static override readonly schema = rawCommentSchema;
  static readonly filters = [commentSoftDeleteFilter] as const;
}

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
  static readonly filters = [commentSoftDeleteFilter] as const;
}

describe('Schema-Driven Soft Delete & Global Entity Filters', () => {
  describe('Schema Definition Metadata & Helpers', () => {
    it('normalizes softDelete: true to default config', () => {
      expect(softDeleteSchema.softDelete).toBeDefined();
      expect(softDeleteSchema.softDelete?.enabled).toBe(true);
      expect(softDeleteSchema.softDelete?.column).toBe('deletedAt');
      expect(typeof softDeleteSchema.softDelete?.deletedValue).toBe('function');
      expect(softDeleteSchema.softDelete?.activeValue).toBeUndefined();
    });

    it('normalizes custom softDelete configuration', () => {
      expect(customSoftDeleteSchema.softDelete).toBeDefined();
      expect(customSoftDeleteSchema.softDelete?.enabled).toBe(true);
      expect(customSoftDeleteSchema.softDelete?.column).toBe('isDeleted');
      expect(customSoftDeleteSchema.softDelete?.deletedValue).toBe(true);
      expect(customSoftDeleteSchema.softDelete?.activeValue).toBe(false);
    });

    it('normalizes globalFilters map', () => {
      expect(softDeleteSchema.globalFilters).toBeDefined();
      expect(typeof softDeleteSchema.globalFilters?.tenant).toBe('function');
      expect(softDeleteSchema.globalFilters?.status).toEqual({ title: { ne: 'banned' } });
    });

    it('getSchemaFilterWhere constructs active filter DTOs', () => {
      const filters = getSchemaFilterWhere(softDeleteSchema, { filterContext: { tenantId: 42 } });
      expect(filters).toEqual([{ deletedAt: { isNull: true } }, { tenantId: 42 }, { title: { ne: 'banned' } }]);
    });

    it('getSchemaFilterWhere respects withDeleted and bypassFilters', () => {
      const withDeleted = getSchemaFilterWhere(softDeleteSchema, { withDeleted: true });
      expect(withDeleted).toEqual([{ tenantId: 1 }, { title: { ne: 'banned' } }]);

      const bypassAll = getSchemaFilterWhere(softDeleteSchema, { bypassFilters: true });
      expect(bypassAll).toEqual([{ deletedAt: { isNull: true } }]);

      const bypassNamed = getSchemaFilterWhere(softDeleteSchema, { bypassFilters: ['tenant'] });
      expect(bypassNamed).toEqual([{ deletedAt: { isNull: true } }, { title: { ne: 'banned' } }]);
    });
  });

  describe('Repository Delete Operations', () => {
    it('issues DELETE with filters applied', async () => {
      const { driver, queries } = createMockDriver([{ id: 10 }]);
      const repo = new PostRepository(driver);

      const deleted = await repo.delete(10);
      expect(deleted).toBe(true);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('DELETE FROM "posts" WHERE "id" = $1 AND "deletedAt" IS NULL');
      expect(queries[0]!.parameters).toEqual([10, 1, 'banned']);
    });

    it('uses activeValue / deletedValue for custom soft delete schemas', async () => {
      const { driver, queries } = createMockDriver([{ id: 5 }]);
      const repo = new CustomArticleRepository(driver);

      await repo.delete(5);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('UPDATE "articles" SET "isDeleted" = $1');
      expect(queries[0]!.parameters[0]).toBeInstanceOf(Date);
      expect(queries[0]!.parameters.slice(1)).toEqual([5, false]);
    });

    it('executes hard DELETE FROM when hardDelete is called', async () => {
      const { driver, queries } = createMockDriver([{ id: 10 }]);
      const repo = new PostRepository(driver);

      await repo.hardDelete(10);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('DELETE FROM "posts" WHERE "id" = $1');
      expect(queries[0]!.parameters).toEqual([10, 1, 'banned']);

      queries.length = 0;
      await repo.hardDelete(10);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('DELETE FROM "posts" WHERE "id" = $1');
    });

    it('executes hard DELETE FROM on schemas without softDelete configuration', async () => {
      const { driver, queries } = createMockDriver([{ id: 3 }]);
      const repo = new CategoryRepository(driver);

      await repo.delete(3);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('DELETE FROM "categories" WHERE "id" = $1');
      expect(queries[0]!.parameters).toEqual([3]);
    });
  });

  describe('Read Queries Automatic Filtering', () => {
    it('find appends active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.find({ title: 'TypeScript' });
      expect(queries).toHaveLength(1);
      const sql = queries[0]!.text;
      expect(sql).toContain('WHERE "title" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 AND "title" != $3');
      expect(queries[0]!.parameters).toEqual(['TypeScript', 1, 'banned']);
    });

    it('findAll appends active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.findAll();
      expect(queries).toHaveLength(1);
      const sql = queries[0]!.text;
      expect(sql).toContain('WHERE "deletedAt" IS NULL AND "tenantId" = $1 AND "title" != $2');
      expect(queries[0]!.parameters).toEqual([1, 'banned']);
    });

    it('findById and findOne append active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.findById(100);
      expect(queries[0]!.text).toContain(
        'WHERE "id" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 AND "title" != $3 LIMIT 1',
      );

      queries.length = 0;
      await repo.findOne({ title: 'Intro' });
      expect(queries[0]!.text).toContain(
        'WHERE "title" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 AND "title" != $3 LIMIT 1',
      );
    });

    it('list appends active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.list({ where: { title: 'Node' } });
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain(
        'WHERE "title" = $1 AND "deletedAt" IS NULL AND "tenantId" = $2 AND "title" != $3 ORDER BY "id" ASC',
      );
    });

    it('aggregate appends active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.aggregate({ computed: { total: { fn: 'count' } } });
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toContain('WHERE "deletedAt" IS NULL AND "tenantId" = $1 AND "title" != $2');
    });

    it('findByFullText and findJoined append active soft-delete and global filter conditions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.findByFullText('title', 'search');
      expect(queries[0]!.text).toContain(
        'WHERE to_tsvector(\'english\', "title") @@ to_tsquery(\'english\', $1) AND "deletedAt" IS NULL AND "tenantId" = $2 AND "title" != $3',
      );

      queries.length = 0;
      await repo.findJoined({ target: 'categories', leftCol: 'posts.id', rightCol: 'categories.id' });
      expect(queries[0]!.text).toContain('WHERE "deletedAt" IS NULL AND "tenantId" = $1 AND "title" != $2');
    });
  });

  describe('Explicit Bypass Options', () => {
    it('withDeleted: true bypasses soft-delete filter', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.find({ title: 'TypeScript' }, { filters: { softDelete: false, tenant: { tenantId: 1 } } });
      expect(queries[0]!.text).not.toContain('"deletedAt" IS NULL');
      expect(queries[0]!.text).toContain('WHERE "title" = $1 AND "tenantId" = $2 AND "title" != $3');
    });

    it('bypassFilters: true bypasses all global filters', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.find({ title: 'TypeScript' }, { filters: { tenant: false, status: false } });
      expect(queries[0]!.text).toContain('"deletedAt" IS NULL');
      expect(queries[0]!.text).not.toContain('"tenantId" =');
      expect(queries[0]!.text).not.toContain('"title" !=');
    });

    it('bypassFilters: string[] bypasses named global filters', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new PostRepository(driver);

      await repo.find({ title: 'TypeScript' }, { filters: { tenant: false } });
      expect(queries[0]!.text).toContain('"deletedAt" IS NULL');
      expect(queries[0]!.text).not.toContain('"tenantId" =');
      expect(queries[0]!.text).toContain('"title" != $2');
    });

    it('filterContext passes context to dynamic filter functions', async () => {
      const { driver, queries } = createMockDriver([]);
      const repo = new ParamPostRepository(driver);

      await repo.find({ id: { gt: 0 } }, { filters: { tenant: { tenantId: 99 } } });
      expect(queries[0]!.parameters).toEqual([0, 99, 'banned']);
    });
  });

  describe('Relational Child Population Constraints', () => {
    it('applies soft-delete filter automatically to child query during populate', async () => {
      const queries: { text: string; parameters: readonly unknown[] }[] = [];
      const mockDriver: Driver = {
        dialect: postgresDialect,
        async execute(query) {
          queries.push({ text: query.text, parameters: query.parameters });
          if (query.text.includes('FROM "users"')) {
            return [{ id: 1, name: 'Alice' }];
          }
          if (query.text.includes('FROM "comments"')) {
            return [{ id: 10, userId: 1, content: 'Active Comment', deletedAt: null }];
          }
          return [];
        },
      };

      const _commentRepo = new CommentRepository(mockDriver);
      const userRepo = new UserRepository(mockDriver);
      const users = await userRepo.findAll({ populate: ['comments'] });

      expect(users).toHaveLength(1);
      expect(queries).toHaveLength(2);
      expect(queries[0]!.text).toContain('FROM "users"');
      expect(queries[1]!.text).toContain('FROM "comments"');
      expect(queries[1]!.text).toContain('"deletedAt" IS NULL');
      expect(users[0]!.comments).toHaveLength(1);
    });

    it('passes withDeleted flag down to relational child population', async () => {
      const queries: { text: string; parameters: readonly unknown[] }[] = [];
      const mockDriver: Driver = {
        dialect: postgresDialect,
        async execute(query) {
          queries.push({ text: query.text, parameters: query.parameters });
          if (query.text.includes('FROM "users"')) {
            return [{ id: 1, name: 'Alice' }];
          }
          return [
            { id: 10, userId: 1, content: 'Active Comment', deletedAt: null },
            { id: 11, userId: 1, content: 'Deleted Comment', deletedAt: new Date() },
          ];
        },
      };

      const _commentRepo = new CommentRepository(mockDriver);
      const userRepo = new UserRepository(mockDriver);
      await userRepo.findAll({ populate: ['comments'], filters: { softDelete: false } });

      expect(queries).toHaveLength(2);
      expect(queries[1]!.text).toContain('FROM "comments"');
      expect(queries[1]!.text).not.toContain('"deletedAt" IS NULL');
    });
  });
});
