// The prototype domain, declared type-first: one interface, no `defineSchema`, no
// `tags.Min(1)` call, no hand-written `TypeDescriptor`.
//
// Read this beside packages/schema-core/src/index.ts:393 — the same facts, moved
// from a value the types are inferred FROM into a type the value is generated FROM.

import type {
  CreateDTO,
  Entity,
  HasDefault,
  Length,
  Max,
  Min,
  MinLength,
  Nullable,
  Pattern,
  PrimaryKey,
  ReadDTO,
  References,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
  UpdateDTO,
  WhereDTO,
} from './tags.ts';

export interface User extends Table<'users'> {
  /** `serial primary key` — dropped from CreateDTO and UpdateDTO by its tags. */
  id: number & Sql<'integer'> & Serial & PrimaryKey & Min<1>;
  /** `varchar(255) not null unique`, validated against a pattern. */
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'>;
  /** A plain constrained integer. */
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  /** Nullable needs no tag: `| null` already says it, and the generator reads it. */
  nickname: Nullable<string & MinLength<3>>;
  /** An enum needs no tag either — a literal union is the enum. */
  role: 'admin' | 'editor' | 'viewer';
  /** `hasDefault` makes it optional on insert but required on the row. */
  createdAt: string & Sql<'timestamp'> & HasDefault;
  /** Excluded from ReadDTO by its tag, never leaves the process. */
  passwordHash: string & Sensitive;
  active: boolean;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'users'>;
  title: string & MinLength<1> & Length<200>;
  tags: string[];
}

// --- the call sites the AOT transformer is expected to rewrite ----------------

declare function assert<T>(input: unknown): T;
declare const raw: unknown;

export const asEntity = assert<Entity<User>>(raw);
export const asCreate = assert<CreateDTO<User>>(raw);
export const asUpdate = assert<UpdateDTO<User>>(raw);
export const asWhere = assert<WhereDTO<User>>(raw);
export const asRead = assert<ReadDTO<User>>(raw);
export const asPost = assert<CreateDTO<Post>>(raw);
