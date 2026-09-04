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
    role: ('admin' | 'user') & HasDefault;
    age: (number & Sql<'integer'>) | null;
  }

  const { schemas } = toOpenApiComponents([schemaOf<User>()]);
}
// #endregion snippet-1

// #region snippet-2
{
  const userSchema = schemaOf<User>();

  // GET /users/{id} — single entity response
  const getSchema = toJsonSchema(userSchema, 'get');
  // All fields required, includes auto-increment

  // POST /users — create request
  const createSchema = toJsonSchema(userSchema, 'create');
  // Excludes id (auto-increment), all fields required

  // PATCH /users/{id} — update request
  const updateSchema = toJsonSchema(userSchema, 'update');
  // All fields optional, excludes id

  // GET /users — list response (includes pagination envelope)
  const listSchema = toListSchema(userSchema);
}
// #endregion snippet-2

// #region snippet-3
{
  interface User extends Table<'users'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    name: string & Sql<'text'>;
    email: string & Sql<'text'>;
  }

  const userSchema = schemaOf<User>();

  // Endpoint definitions with OpenAPI schema
  const routes = [
    {
      method: 'GET',
      path: '/users',
      schema: {
        response: {
          200: toListSchema(userSchema),
        },
      },
      handler: async (req, reply) => {
        return repo.findAll();
      },
    },
    {
      method: 'GET',
      path: '/users/{id}',
      schema: {
        params: { type: 'object', properties: { id: { type: 'integer' } } },
        response: { 200: toJsonSchema(userSchema, 'get') },
      },
      handler: async (req, reply) => {
        return repo.findById(req.params.id);
      },
    },
  ];
}
// #endregion snippet-3

// #region snippet-4
{
  interface Account extends Table<'accounts'> {
    email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'> & MaxLength<255>;
    age: (number & Sql<'integer'> & Min<0>) | null;
  }

  const schema = toJsonSchema(schemaOf<Account>(), 'entity');
  // email: { type: 'string', pattern: '^[^@]+@[^@]+\.[^@]+$', maxLength: 255 }
  // age: { type: ['integer', 'null'], minimum: 0 }
}
// #endregion snippet-4

// #region snippet-5
{
  const fullSpec = {
    openapi: '3.0.0',
    info: {
      title: 'My API',
      version: '1.0.0',
    },
    paths: {
      '/users': {
        get: {
          summary: 'List users',
          responses: {
            200: {
              description: 'User list',
              content: {
                'application/json': {
                  schema: toListSchema(userSchema),
                },
              },
            },
          },
        },
        post: {
          summary: 'Create user',
          requestBody: {
            content: {
              'application/json': {
                schema: toJsonSchema(userSchema, 'create'),
              },
            },
          },
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': {
                  schema: toJsonSchema(userSchema, 'entity'),
                },
              },
            },
          },
        },
      },
    },
    components: toOpenApiComponents([userSchema]),
  };
}
// #endregion snippet-5

// #region snippet-6
{
  const searchSchema = toSearchSchema(userSchema);
  // {
  //   "type": "object",
  //   "properties": {
  //     "items": {
  //       "type": "array",
  //       "items": {
  //         "type": "object",
  //         "properties": {
  //           "id": { "type": "integer" },
  //           "name": { "type": "string" },
  //           ...
  //           "_score": { "type": "number" }  // FTS ranking
  //         },
  //         "required": ["id", "name", ...]
  //       }
  //     },
  //     "total": { "type": "integer" },
  //     "hasMore": { "type": "boolean" },
  //     "cursor": { "type": "string" }
  //   },
  //   "required": ["hasMore", "items"]
  // }
}
// #endregion snippet-6
