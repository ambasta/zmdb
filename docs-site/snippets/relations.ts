import { attachPopulated, compilePopulate, resolveRelation, type JoinRow } from '@zmdb/schema-core/relations';
import { sqliteDriver } from '@zmdb/sqlite';
import { schemaOf, defineRepository } from 'zmdb';
import type { Entity, Populated } from 'zmdb/derive';
import type { ManyToOne, OneToMany, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

// #region snippet-1
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  posts?: Post[] & OneToMany<'posts', 'userId'>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  title: string & Sql<'text'>;
  author?: User & ManyToOne<'users', 'userId'>;
}
// #endregion snippet-1

const db = {} as any;
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });
const UserSchema = schemaOf<User>();
const PostSchema = schemaOf<Post>();

// #region snippet-2
{
  (async () => {
    const user = await users.findById(1, { populate: ['posts'] });
    // user.posts: readonly Entity<Post>[]
  })();
}
// #endregion snippet-2

// #region snippet-3
type UserWithPosts = Populated<User, 'posts'>;
// { id: number; email: string; posts: readonly Entity<Post>[] }

type PostWithAuthor = Populated<Post, 'author'>;
// { id: number; userId: number; title: string; author: Entity<User> | null }
// #endregion snippet-3

// #region snippet-4
{
  resolveRelation(PostSchema.ir, 'author');
  // { name: 'author', targetTable: 'users', parentKey: 'userId', targetKey: 'id', toMany: false }
}
// #endregion snippet-4

// #region snippet-5
{
  const query = compilePopulate(UserSchema.ir, 'posts', 'postgres', [1, 2, 3]);
  // query.kind: 'batched'
  // query.sql: SELECT * FROM "posts" WHERE "userId" IN ($1, $2, $3)

  const query2 = compilePopulate(PostSchema.ir, 'author', 'postgres');
  // query2.kind: 'join'
  // query2.sql: SELECT * FROM "posts" INNER JOIN "users" ON "posts"."userId" = "users"."id"
}
// #endregion snippet-5

// #region snippet-6
{
  const user = { id: 1, email: 'user@example.com' };
  const posts = [{ id: 1, userId: 1, title: 'First Post' }];
  const userWithPosts = attachPopulated(user, 'posts', posts);
  // { id: 1, email: 'user@example.com', posts: [...] }
}
// #endregion snippet-6

// #region snippet-7
type UserPostInner = JoinRow<Entity<User>, Entity<Post>, 'inner'>;
// All columns present

type UserPostLeft = JoinRow<Entity<User>, Entity<Post>, 'left'>;
// Joined columns are Partial<>
// #endregion snippet-7
