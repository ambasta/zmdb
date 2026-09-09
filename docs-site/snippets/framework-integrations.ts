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
  interface CreateUserInput {
    name: string;
    email: string;
  }

  const handler: Handler<CreateUserInput, User> = {
    validate: raw => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid input');
      const r = raw as Record<string, unknown>;
      if (typeof r.name !== 'string') throw new Error('name required');
      if (typeof r.email !== 'string') throw new Error('email required');
      return r as CreateUserInput;
    },
    handle: async input => {
      return repo.create(input);
    },
  };

  const endpoint = makeEndpoint(handler);
  // endpoint: (raw: unknown) => Promise<EndpointResult>
}
// #endregion snippet-1

// #region snippet-2
{
  const app = express();
  app.use(express.json());

  app.post('/users', async (req, res) => {
    const result = await endpoint(req.body);
    res.status(result.status).send(result.body);
  });
}
// #endregion snippet-2

// #region snippet-3
{
  const app = new Hono();
  app.post('/users', async c => {
    const result = await endpoint(await c.req.json());
    return c.body(result.body, result.status);
  });
}
// #endregion snippet-3

// #region snippet-4
{
  const t = initTRPC.create();
  export const appRouter = t.router({
    createUser: t.procedure
      .input(z.object({ name: z.string(), email: z.string() }))
      .mutation(({ input }) => endpoint(input)),
  });
}
// #endregion snippet-4

// #region snippet-5
{
  @Controller('users')
  class UserController {
    @Post()
    async create(@Body() body: unknown) {
      const result = await endpoint(body);
      return JSON.parse(result.body);
    }
  }
}
// #endregion snippet-5

// #region snippet-6
{
  const handler: Handler<Input, Output> = {
    validate: (() => {}) as any,
    handle: (() => {}) as any,
    serialize: out => JSON.stringify(out), // default
    // Or use a custom serializer
    // serialize: (out) => YAML.stringify(out),
  };
}
// #endregion snippet-6
