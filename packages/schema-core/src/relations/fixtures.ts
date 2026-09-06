// The schemas the relation tests point at.
//
// One of each cardinality, because `resolveRelation` has a branch per side of a relation and
// each of them is a different pair of columns: `posts` is the inverse of a foreign key,
// `author` is the owning side of the same one, `profile` is a one-to-one declared on the
// table that does *not* hold the key, and `tags` is the many-to-many that has no column to
// resolve at all. The runtime spec and the `.type-test.ts` compilation gate both need them,
// and they only test the same claim while they agree about the shape.
//
// The declaration is the interface; the schema values below are read off it the way a
// build would. See `@zmdb/compiler/testing`.
import { schemasFrom } from '@zmdb/compiler/testing';

import type {
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
} from '../tags/index.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  posts?: Post[] & OneToMany<'posts', 'userId'>;
  /** `users` has no `userId`, which is how the resolver knows this is the inverse side. */
  profile?: Profile & OneToOne<'profiles', 'userId'>;
  tags?: Tag[] & ManyToMany<'tags', 'user_tags'>;
}

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  bio: string & Sql<'text'>;
  user?: User & ManyToOne<'users', 'userId'>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  title: string & Sql<'text'>;
  author?: User & ManyToOne<'users', 'userId'>;
}

export interface Tag extends Table<'tags'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  label: string & Sql<'text'>;
}

export const {
  User: UserSchema,
  Profile: ProfileSchema,
  Post: PostSchema,
} = schemasFrom<{ User: User; Profile: Profile; Post: Post }>(import.meta.url, ['User', 'Profile', 'Post']);
