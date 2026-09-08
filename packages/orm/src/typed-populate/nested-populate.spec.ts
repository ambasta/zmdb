import { DatabaseSync } from 'node:sqlite';

import { BaseRepository, createLoaderScope, type ReadOptions, type RepositoryOptions } from '@zmdb/orm';
import { type CompiledQuery } from '@zmdb/sql';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, expect, it } from 'vitest';

import {
  NestedCommentSchema,
  NestedPostSchema,
  NestedProfileSchema,
  NestedUserSchema,
  type NestedUser,
} from './nested.fixtures.js';

class Users extends BaseRepository<NestedUser> {
  static override readonly schema = NestedUserSchema;
}

function fixture(options: RepositoryOptions = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_users (tenant_id INTEGER, id INTEGER, name TEXT, PRIMARY KEY (tenant_id, id));
    CREATE TABLE blog_posts (tenant_id INTEGER, id INTEGER, user_id INTEGER, title TEXT, PRIMARY KEY (tenant_id, id));
    CREATE TABLE post_comments (tenant_id INTEGER, id INTEGER, post_id INTEGER, author_id INTEGER, body TEXT, hidden INTEGER, PRIMARY KEY (tenant_id, id));
    CREATE TABLE user_profiles (tenant_id INTEGER, id INTEGER, user_id INTEGER, bio TEXT, PRIMARY KEY (tenant_id, id));
    INSERT INTO app_users VALUES (1,1,'Ada'),(1,2,'Alan'),(2,1,'Grace');
    INSERT INTO blog_posts VALUES (1,10,1,'First'),(1,11,1,'Second'),(2,10,1,'Other tenant');
    INSERT INTO post_comments VALUES (1,100,10,2,'Visible',0),(1,101,10,NULL,'Hidden',1),(1,102,11,99,'Orphan',0),(2,100,10,1,'Other comment',0);
    INSERT INTO user_profiles VALUES (1,1,1,'Ada profile');
  `);
  const queries: CompiledQuery[] = [];
  const driver = sqliteDriver(db);
  const repo = new Users(driver, undefined, {
    schemas: [NestedPostSchema, NestedCommentSchema, NestedProfileSchema],
    ...options,
    onQuery: query => queries.push(query),
  });
  return { db, driver, repo, queries };
}

describe('nested and deferred population', () => {
  it('batches shared prefixes across composite keys and preserves nullable relations and physical names', async () => {
    const { db, repo, queries } = fixture();
    try {
      const rows = await repo.findAll({
        populate: ['posts', 'posts.comments', 'posts.comments.author', 'posts.comments'],
      });
      expect(queries).toHaveLength(4);
      expect(
        rows.map(row => [
          row.name,
          row.posts.map(post => post.comments.map(comment => [comment.body, comment.author?.name ?? null])),
        ]),
      ).toEqual([
        [
          'Ada',
          [
            [
              ['Visible', 'Alan'],
              ['Hidden', null],
            ],
            [['Orphan', null]],
          ],
        ],
        ['Alan', []],
        ['Grace', [[['Other comment', 'Grace']]]],
      ]);
      expect(queries.map(query => query.text)).toEqual([
        expect.stringContaining('"app_users"'),
        expect.stringContaining('"blog_posts"'),
        expect.stringContaining('"post_comments"'),
        expect.stringContaining('"app_users"'),
      ]);
      expect(rows[0]?.posts[0]?.comments[0]).not.toHaveProperty('author_id');
    } finally {
      db.close();
    }
  });

  it.each(['findById', 'findOne', 'find', 'list'] as const)('%s accepts nested paths', async method => {
    const { db, repo } = fixture();
    try {
      const options = { populate: ['posts.comments'] as const };
      const key = { tenantId: 1, id: 1 };
      const rows =
        method === 'findById'
          ? [await repo.findById(key, options)]
          : method === 'findOne'
            ? [await repo.findOne(key, options)]
            : method === 'find'
              ? await repo.find(key, options)
              : (await repo.list({ where: key }, options)).items;
      expect(rows[0]?.posts[0]?.comments.map(comment => comment.body)).toEqual(['Visible', 'Hidden']);
    } finally {
      db.close();
    }
  });

  it('traverses a to-one prefix and a finite cycle without dropping unmatched parents', async () => {
    const { db, repo, queries } = fixture();
    try {
      const rows = await repo.findAll({ populate: ['profile.user.posts.comments'] });
      expect(rows[0]?.profile?.user?.posts[0]?.comments).toHaveLength(2);
      expect(rows.slice(1).map(row => row.profile)).toEqual([null, null]);
      expect(queries).toHaveLength(5);
    } finally {
      db.close();
    }
  });

  it('populates existing single and collection records without refetching or mutating roots', async () => {
    const { db, repo, queries } = fixture();
    try {
      const roots = await repo.findAll();
      const first = roots[0];
      if (!first) throw new Error('seed omitted Ada');
      queries.length = 0;
      const rows = await repo.populate(roots, ['posts.comments']);
      expect(queries).toHaveLength(2);
      expect(rows[0]?.posts[0]?.comments).toHaveLength(2);
      expect(rows[0]).not.toBe(first);
      expect(first).not.toHaveProperty('posts');
      queries.length = 0;
      const one = await repo.populate(first, ['profile.user']);
      expect(one.profile?.user?.name).toBe('Ada');
      expect(one).not.toBe(first);
      expect(queries).toHaveLength(2);
      queries.length = 0;
      expect(await repo.populate([], ['posts.comments'])).toEqual([]);
      expect(queries).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it.each(['posts.missing', 'posts.comments.body', 'posts..comments', '.posts', 'posts.', 'groups'])(
    'rejects invalid path %s before SQL',
    async path => {
      const { db, repo, queries } = fixture();
      try {
        await expect(Reflect.apply(repo.findAll, repo, [{ populate: [path] }])).rejects.toThrow(
          /relation|populate path/,
        );
        expect(queries).toHaveLength(0);
      } finally {
        db.close();
      }
    },
  );

  it.each([[NestedCommentSchema], [NestedPostSchema]])(
    'refuses a missing nested target schema before SQL',
    async (...schemas) => {
      const { db, repo, queries } = fixture({ schemas });
      try {
        await expect(repo.findAll({ populate: ['posts.comments'] })).rejects.toThrow(
          /schema.*nested_(posts|comments)|nested_(posts|comments).*schema/,
        );
        expect(queries).toHaveLength(0);
      } finally {
        db.close();
      }
    },
  );

  it('applies nested target filters and per-call overrides before executing a root query', async () => {
    const { db, repo, queries } = fixture({
      filters: [
        {
          name: 'visibility',
          schema: NestedCommentSchema,
          where: ({ hidden }: { hidden: number }) => [{ col: 'hidden', op: '=', value: hidden }],
        },
      ],
    });
    try {
      await expect(repo.findAll({ populate: ['posts.comments'] })).rejects.toThrow(/visibility.*parameters/);
      expect(queries).toHaveLength(0);
      const roots = await repo.findAll();
      queries.length = 0;
      const visible = await repo.populate(roots, ['posts.comments'], { filters: { visibility: { hidden: 0 } } });
      expect(visible[0]?.posts[0]?.comments.map(comment => comment.body)).toEqual(['Visible']);
      expect(queries).toHaveLength(2);
      const all = await repo.populate(roots, ['posts.comments'], { filters: { visibility: false } });
      expect(all[0]?.posts[0]?.comments).toHaveLength(2);
      queries.length = 0;
      await expect(
        repo.populate(roots, ['posts.comments'], { signal: AbortSignal.abort(new Error('stopped')) }),
      ).rejects.toThrow('stopped');
      expect(queries).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('scope batches concurrent deferred calls by canonical paths without caching later results', async () => {
    const { db, repo, queries } = fixture();
    try {
      const roots = await repo.findAll();
      const first = roots[0];
      if (!first) throw new Error('seed omitted Ada');
      const scope = createLoaderScope();
      const options: ReadOptions = {};
      queries.length = 0;
      const [one, many] = await Promise.all([
        scope.populate(repo, first, ['posts.comments', 'profile'], options),
        scope.populate(repo, roots, ['profile', 'posts.comments', 'profile'], options),
      ]);
      expect(queries).toHaveLength(3);
      expect(one.posts[0]?.comments).toHaveLength(2);
      expect(many[0]?.posts[0]?.comments).toHaveLength(2);
      expect(one).not.toBe(many[0]);
      expect(one.posts[0]).not.toBe(many[0]?.posts[0]);
      expect(first).not.toHaveProperty('posts');
      await scope.populate(repo, first, ['posts.comments', 'profile'], options);
      expect(queries).toHaveLength(6);
    } finally {
      db.close();
    }
  });

  it('scope separates read-options identities and transaction repositories', async () => {
    const { db, repo, driver, queries } = fixture();
    try {
      const roots = await repo.findAll();
      const first = roots[0];
      if (!first) throw new Error('seed omitted Ada');
      const scope = createLoaderScope();
      queries.length = 0;
      await Promise.all([
        scope.populate(repo, first, ['posts.comments'], {}),
        scope.populate(repo, first, ['posts.comments'], {}),
      ]);
      expect(queries).toHaveLength(4);
      queries.length = 0;
      db.exec('BEGIN');
      const txRepo = repo.withTransaction(driver);
      await Promise.all([
        scope.populate(repo, first, ['posts.comments']),
        scope.populate(txRepo, first, ['posts.comments']),
      ]);
      expect(queries).toHaveLength(4);
      db.exec('ROLLBACK');
    } finally {
      db.close();
    }
  });
});
