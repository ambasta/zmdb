import { type OneToMany, type Physical, type PrimaryKey, type Sql, type Table } from '@zmdb/schema/tags';

export interface RcaUser extends Table<'rca_users'>, Physical<'rca_orm_users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: number & Sql<'integer'> & Physical<'tenant_id'>;
  name: string & Sql<'text'>;
  posts?: RcaPost[] & OneToMany<'rca_posts', 'userId'>;
}

export interface RcaPost extends Table<'rca_posts'>, Physical<'rca_orm_posts'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & Physical<'user_id'>;
  title: string & Sql<'text'>;
  comments?: RcaComment[] & OneToMany<'rca_comments', 'postId'>;
}

export interface RcaComment extends Table<'rca_comments'>, Physical<'rca_orm_comments'> {
  id: number & Sql<'integer'> & PrimaryKey;
  postId: number & Sql<'integer'> & Physical<'post_id'>;
  body: string & Sql<'text'>;
}
