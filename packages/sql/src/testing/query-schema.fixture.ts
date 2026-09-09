import { schemasFrom } from '@zmdb/compiler/testing';
import {
  type Fts,
  type HasDefault,
  type Physical,
  type PrimaryKey,
  type Serial,
  type Sql,
  type Table,
} from '@zmdb/schema/tags';

export interface QueryUser extends Table<'users'>, Physical<'user_accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey & Physical<'user_id'>;
  displayName: string & Sql<'text'> & Physical<'display_name'>;
  age: number & Sql<'integer'> & HasDefault & Physical<'age_years'>;
  active: boolean & Sql<'boolean'> & HasDefault & Physical<'active_flag'>;
  nickname: (string & Sql<'text'>) | null;
}

export interface QueryPost extends Table<'posts'>, Physical<'blog_posts'>, Fts<'blog_search'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey & Physical<'post_id'>;
  userId: number & Sql<'integer'> & Physical<'author_id'>;
  title: string & Sql<'text'> & Physical<'post_title'>;
  views: number & Sql<'integer'> & HasDefault & Physical<'view_count'>;
}

export const { QueryUser: QueryUserSchema, QueryPost: QueryPostSchema } = schemasFrom<{
  QueryUser: QueryUser;
  QueryPost: QueryPost;
}>(import.meta.url, ['QueryUser', 'QueryPost']);
