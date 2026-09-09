// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { schemasFrom } from '@zmdb/compiler/testing';
import {
  type ManyToMany,
  type ManyToOne,
  type OneToMany,
  type OneToOne,
  type Physical,
  type PrimaryKey,
  type References,
  type Sql,
  type Table,
} from '@zmdb/schema/tags';

export interface NestedUser extends Table<'nested_users'>, Physical<'app_users'> {
  tenantId: number & Sql<'integer'> & PrimaryKey & Physical<'tenant_id'>;
  id: number & Sql<'integer'> & PrimaryKey;
  name: string & Sql<'text'>;
  posts?: NestedPost[] & OneToMany<'nested_posts', 'tenantId,userId'>;
  profile?: NestedProfile & OneToOne<'nested_profiles', 'tenantId,userId'>;
  groups?: NestedUser[] & ManyToMany<'nested_users', 'user_groups'>;
}

export interface NestedPost extends Table<'nested_posts'>, Physical<'blog_posts'> {
  tenantId: number & Sql<'integer'> & PrimaryKey & References<'nested_users.tenantId'> & Physical<'tenant_id'>;
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'nested_users.id'> & Physical<'user_id'>;
  title: string & Sql<'text'>;
  comments?: NestedComment[] & OneToMany<'nested_comments', 'tenantId,postId'>;
}

export interface NestedComment extends Table<'nested_comments'>, Physical<'post_comments'> {
  tenantId: number & Sql<'integer'> & PrimaryKey & References<'nested_users.tenantId'> & Physical<'tenant_id'>;
  id: number & Sql<'integer'> & PrimaryKey;
  postId: number & Sql<'integer'> & Physical<'post_id'>;
  authorId: (number & Sql<'integer'> & References<'nested_users.id'> & Physical<'author_id'>) | null;
  body: string & Sql<'text'>;
  hidden: number & Sql<'integer'>;
  author?: NestedUser & ManyToOne<'nested_users', 'tenantId,authorId'>;
}

export interface NestedProfile extends Table<'nested_profiles'>, Physical<'user_profiles'> {
  tenantId: number & Sql<'integer'> & PrimaryKey & References<'nested_users.tenantId'> & Physical<'tenant_id'>;
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'nested_users.id'> & Physical<'user_id'>;
  bio: string & Sql<'text'>;
  user?: NestedUser & ManyToOne<'nested_users', 'tenantId,userId'>;
}

export const {
  NestedUser: NestedUserSchema,
  NestedPost: NestedPostSchema,
  NestedComment: NestedCommentSchema,
  NestedProfile: NestedProfileSchema,
} = schemasFrom<{
  NestedUser: NestedUser;
  NestedPost: NestedPost;
  NestedComment: NestedComment;
  NestedProfile: NestedProfile;
}>(import.meta.url, ['NestedUser', 'NestedPost', 'NestedComment', 'NestedProfile']);
