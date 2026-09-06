import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/compiler/testing';
import type { ManyToOne, OneToMany, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, it, expect, beforeEach } from 'vitest';

import { BaseRepository } from './index.js';

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

const { User: UserSchema, Order: OrderSchema } = schemasFrom<{ User: User; Order: Order }>(import.meta.url, [
  'User',
  'Order',
]);
const { TenantUser: TenantUserSchema, TenantPost: TenantPostSchema } = schemasFrom<{
  TenantUser: TenantUser;
  TenantPost: TenantPost;
}>(import.meta.url, ['TenantUser', 'TenantPost']);

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
