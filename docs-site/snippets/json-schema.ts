import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO, Populated } from 'zmdb/derive';
import type {
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  Pattern,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
  Unique,
} from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\.[^@]+$'>;
  name?: string & Sql<'text'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  authorId: number & Sql<'integer'> & References<'users.id'>;
}

const db = {} as any;
const driver: Driver = { dialect: 'sqlite', execute: async () => [] };
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(db), { dialect: 'sqlite' });
const posts = defineRepository(schemaOf<Post>(), sqliteDriver(db), { dialect: 'sqlite' });
const qb = createQueryCompiler('sqlite');
const compiler = qb;
const builder = qb.selectFrom('users');

// #region snippet-1
{
  interface User extends Table<'users'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    email: string & Sql<'text'>;
    age: number & Sql<'integer'> & Min<0>;
  }

  const userSchema = schemaOf<User>();
  const jsonSchema = toJsonSchema(userSchema, 'entity');
}
// #endregion snippet-1

// #region snippet-2
{
  // Entity (response) — all columns including auto-increment
  toJsonSchema(userSchema, 'entity');

  // Create — excludes auto-increment columns
  toJsonSchema(userSchema, 'create');
  // { type: 'object', properties: { email: {...}, age: {...} }, required: ['email'] }

  // Update — all columns optional
  toJsonSchema(userSchema, 'update');
  // { type: 'object', properties: { email: {...}, age: {...} }, required: [] }

  // GET /list /search — same as entity (response)
  toJsonSchema(userSchema, 'get');
  toJsonSchema(userSchema, 'list');
  toJsonSchema(userSchema, 'search');
}
// #endregion snippet-2

// #region snippet-3
{
  // Min<N>          -> minimum
  // Max<N>          -> maximum
  // MinLength<N>    -> minLength
  // MaxLength<N>    -> maxLength
  // Length<N>       -> maxLength
  // Pattern<S>      -> pattern
  // a literal union -> enum
}
// #endregion snippet-3

// #region snippet-4
{
  interface Product extends Table<'products'> {
    name: string & Sql<'text'> & MinLength<1> & MaxLength<100>;
    price: number & Sql<'numeric'> & Min<0>;
    code: string & Sql<'text'> & Pattern<'^[A-Z]{3}$'>;
    status: 'active' | 'inactive';
  }

  const jsonSchema = toJsonSchema(schemaOf<Product>(), 'entity');
  // {
  //   "type": "object",
  //   "properties": {
  //     "name": { "type": "string", "minLength": 1, "maxLength": 100 },
  //     "price": { "type": "number", "minimum": 0 },
  //     "code": { "type": "string", "pattern": "^[A-Z]{3}$" },
  //     "status": { "type": "string", "enum": ["active", "inactive"] }
  //   },
  //   "required": ["status", "name", "price", "code"]
  // }
}
// #endregion snippet-4

// #region snippet-5
{
  interface Profile extends Table<'profiles'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    bio: (string & Sql<'text'>) | null; // nullable column
    avatar: string & Sql<'text'>; // required
  }

  const jsonSchema = toJsonSchema(schemaOf<Profile>(), 'entity');
  // {
  //   "properties": {
  //     "bio": { "type": ["string", "null"] },  // union with null
  //     "avatar": { "type": "string" }
  //   },
  //   "required": ["id", "avatar"]
  // }
}
// #endregion snippet-5

// #region snippet-6
{
  const schemas = toOpenApiComponents([schemaOf<User>(), schemaOf<Order>(), schemaOf<Product>()]);

  // Returns: { schemas: { User: {...}, Order: {...}, Product: {...} } }
}
// #endregion snippet-6

// #region snippet-7
{
  const listSchema = toListSchema(userSchema);
  // {
  //   "type": "object",
  //   "properties": {
  //     "items": { "type": "array", "items": <User schema> },
  //     "total": { "type": "integer" },
  //     "hasMore": { "type": "boolean" },
  //     "cursor": { "type": "string" }
  //   },
  //   "required": ["hasMore", "items"]
  // }

  const searchSchema = toSearchSchema(userSchema);
  // Similar to list, but each item includes "_score" for FTS ranking
}
// #endregion snippet-7
