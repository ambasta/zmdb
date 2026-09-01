import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { CompiledQuery } from '@zmdb/query-compiler';
import type {
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
} from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, it, expect, beforeEach } from 'vitest';

import { BaseRepository, defineRepository } from './index.js';

// #34: integrate populate() into the repository + E2E (real SQLite).

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'>;
  total: number & Sql<'integer'>;
}

export interface TenantUser extends Table<'tenant_users'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'>;
  posts?: TenantPost[] & OneToMany<'tenant_posts', 'tenantId,userId'>;
}

export interface TenantPost extends Table<'tenant_posts'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: string & Sql<'text'> & References<'tenant_users.tenantId'>;
  userId: number & Sql<'integer'> & References<'tenant_users.id'>;
  title: string & Sql<'text'>;
  author?: TenantUser & ManyToOne<'tenant_users', 'tenantId,userId'>;
}

export interface Tag extends Table<'tags'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  tags?: Tag[] & ManyToMany<'tags', 'post_tags'>;
}

export interface ExplicitPost extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  tags?: Tag[] & ManyToMany<'tags', 'custom_pivot', 'custom_post_id', 'custom_tag_id'>;
}

const {
  User: UserSchema,
  Order: OrderSchema,
  TenantUser: TenantUserSchema,
  TenantPost: TenantPostSchema,
  Tag: TagSchema,
  Post: PostSchema,
  ExplicitPost: ExplicitPostSchema,
} = schemasFrom<{
  User: User;
  Order: Order;
  TenantUser: TenantUser;
  TenantPost: TenantPost;
  Tag: Tag;
  Post: Post;
  ExplicitPost: ExplicitPost;
}>(import.meta.url, ['User', 'Order', 'TenantUser', 'TenantPost', 'Tag', 'Post', 'ExplicitPost']);

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}
class OrderRepository extends BaseRepository<Order> {
  static override readonly schema = OrderSchema;
}
class TenantUserRepository extends BaseRepository<TenantUser> {
  static override readonly schema = TenantUserSchema;
}
class TenantPostRepository extends BaseRepository<TenantPost> {
  static override readonly schema = TenantPostSchema;
}

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)');
  db.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)',
  );
  db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)');
  db.exec('CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  db.exec('CREATE TABLE post_tags (postId INTEGER NOT NULL, tagId INTEGER NOT NULL)');
  db.exec('CREATE TABLE custom_pivot (custom_post_id INTEGER NOT NULL, custom_tag_id INTEGER NOT NULL)');
});

describe('populate to-many E2E (real SQLite)', () => {
  it('attaches child orders to each user, as plain rows (no shared refs)', async () => {
    const driver = sqliteDriver(db);
    const users = new UserRepository(driver, 'sqlite');
    const orders = new OrderRepository(driver, 'sqlite');

    const u1 = await users.create({ email: 'a@b.com' });
    const u2 = await users.create({ email: 'c@d.com' });
    await orders.create({ userId: u1.id, total: 10 });
    await orders.create({ userId: u1.id, total: 20 });
    await orders.create({ userId: u2.id, total: 30 });

    const populated = await users.findAllWithMany('orders', 'orders', 'userId');
    const byId = new Map(populated.map(p => [p.id, p]));

    expect((byId.get(u1.id)!.orders as unknown[]).length).toBe(2);
    expect((byId.get(u2.id)!.orders as unknown[]).length).toBe(1);
    expect((byId.get(u2.id)!.orders as { total: number }[])[0]!.total).toBe(30);

    // No shared references: each user's orders array is distinct.
    expect(byId.get(u1.id)!.orders).not.toBe(byId.get(u2.id)!.orders);
  });

  it('keeps composite parent relations separated by every key column', async () => {
    db.exec(`
      CREATE TABLE tenant_users (
        tenantId TEXT NOT NULL,
        id INTEGER NOT NULL,
        email TEXT NOT NULL,
        PRIMARY KEY (tenantId, id)
      );
      CREATE TABLE tenant_posts (
        id INTEGER PRIMARY KEY,
        tenantId TEXT NOT NULL,
        userId INTEGER NOT NULL,
        title TEXT NOT NULL
      );
      INSERT INTO tenant_users (tenantId, id, email) VALUES
        ('t1', 1, 'one@t1.example'),
        ('t2', 1, 'one@t2.example');
      INSERT INTO tenant_posts (id, tenantId, userId, title) VALUES
        (10, 't1', 1, 't1 post'),
        (20, 't2', 1, 't2 post');
    `);

    const driver = sqliteDriver(db);
    const users = new TenantUserRepository(driver, 'sqlite');
    const posts = new TenantPostRepository(driver, 'sqlite');
    const populatedUsers = await users.findAll({ populate: ['posts'] });
    const populatedPosts = await posts.findAll({ populate: ['author'] });
    const userByTenant = new Map(populatedUsers.map(user => [user.tenantId, user]));
    const postByTenant = new Map(populatedPosts.map(post => [post.tenantId, post]));

    expect(userByTenant.get('t1')?.posts.map(post => post.title)).toEqual(['t1 post']);
    expect(userByTenant.get('t2')?.posts.map(post => post.title)).toEqual(['t2 post']);
    expect(postByTenant.get('t1')?.author?.email).toBe('one@t1.example');
    expect(postByTenant.get('t2')?.author?.email).toBe('one@t2.example');
  });
});

describe('populate many-to-many E2E (real SQLite)', () => {
  it('hydrates target entity arrays using zero-config inferred foreign keys', async () => {
    const driver = sqliteDriver(db);
    const posts = defineRepository(PostSchema, driver, { dialect: 'sqlite' });

    db.exec("INSERT INTO posts (id, title) VALUES (1, 'First Post'), (2, 'Second Post'), (3, 'Third Post')");
    db.exec("INSERT INTO tags (id, name) VALUES (10, 'TypeScript'), (20, 'Database')");
    db.exec('INSERT INTO post_tags (postId, tagId) VALUES (1, 10), (1, 20), (2, 20)');

    const p1 = await posts.findById(1, { populate: ['tags'] });
    expect(p1?.title).toBe('First Post');
    expect(p1?.tags).toHaveLength(2);
    expect(p1?.tags.map(t => t.name).toSorted()).toEqual(['Database', 'TypeScript']);

    const all = await posts.find({}, { populate: ['tags'] });
    expect(all).toHaveLength(3);
    const byId = new Map(all.map(p => [p.id, p]));
    expect(byId.get(1)?.tags).toHaveLength(2);
    expect(byId.get(2)?.tags).toHaveLength(1);
    expect(byId.get(3)?.tags).toEqual([]);
  });

  it('hydrates target entity arrays using explicit foreign keys on many-to-many relation', async () => {
    const driver = sqliteDriver(db);
    const posts = defineRepository(ExplicitPostSchema, driver, { dialect: 'sqlite' });

    db.exec("INSERT INTO posts (id, title) VALUES (1, 'Explicit FK Post')");
    db.exec("INSERT INTO tags (id, name) VALUES (50, 'ORM')");
    db.exec('INSERT INTO custom_pivot (custom_post_id, custom_tag_id) VALUES (1, 50)');

    const post = await posts.findById(1, { populate: ['tags'] });
    expect(post?.tags).toHaveLength(1);
    expect(post?.tags[0]?.name).toBe('ORM');
  });

  it('completes gracefully on empty pivot table without executing invalid secondary queries', async () => {
    const executedQueries: string[] = [];
    const rawDriver = sqliteDriver(db);
    const trackingDriver = {
      ...(rawDriver.dialect ? { dialect: rawDriver.dialect } : {}),
      async execute(q: CompiledQuery) {
        executedQueries.push(q.text);
        return rawDriver.execute(q);
      },
    };

    const posts = defineRepository(PostSchema, trackingDriver, { dialect: 'sqlite' });
    db.exec("INSERT INTO posts (id, title) VALUES (1, 'Lonely Post')");

    executedQueries.length = 0;
    const post = await posts.findById(1, { populate: ['tags'] });
    expect(post?.tags).toEqual([]);

    // Should query posts (1), then pivot post_tags (1), and short-circuit without querying tags table
    expect(executedQueries).toHaveLength(2);
    expect(executedQueries[0]).toMatch(/SELECT .* FROM ["`]?posts["`]?/i);
    expect(executedQueries[1]).toMatch(/SELECT .* FROM ["`]?post_tags["`]?/i);
  });
});
