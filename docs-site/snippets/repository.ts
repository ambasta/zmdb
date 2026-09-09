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
  class UserRepository extends BaseRepository<User> {
    static readonly schema = UserSchema;
  }
}
// #endregion snippet-1

// #region snippet-2
{
  const driver: Driver = {
    async execute(query) {
      // query.text: SQL string
      // query.parameters: $1, $2, ... placeholders
      const result = await pg.query(query.text, query.parameters);
      return result.rows;
    },
  };

  const users = new UserRepository(driver, 'postgres');
}
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    // CREATE — validates against CreateDTO<UserSchema>
    // { email: string; role?: 'admin'|'user'|'guest' }
    const created = await users.create({ email: 'a@b.com', role: 'user' });
    // created: Entity<UserSchema>

    // READ — returns plain objects
    const byId = await users.findById(created.id);
    // byId: Entity<UserSchema> | undefined

    const byEmail = await users.findOne({ email: 'a@b.com' });
    // byEmail: Entity<UserSchema> | undefined

    const all = await users.findAll();
    // all: readonly Entity<UserSchema>[]

    // UPDATE — UpdatePatch<User>: strict values or branded expressions
    const updated = await users.update(created.id, { role: 'admin' });
    // updated: Entity<UserSchema> | undefined

    // UPDATE MANY — one validated patch over a typed WhereDTO
    const affected = await users.updateMany({ role: 'guest' }, { role: 'user' });
    // affected: number | undefined (undefined on MySQL)

    // DELETE — returns boolean indicating if a row was deleted
    const deleted = await users.delete(created.id);
    // deleted: boolean
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  (async () => {
    // find(where: WhereDTO<S>) → readonly Entity<S>[]
    const admins = await users.find({ role: 'admin', age: { gte: 18 } });

    // findOne(where) adds LIMIT 1
    const one = await users.findOne({ email: 'a@b.com' });

    // list(query) → ListResult<Entity<S>>  { items, hasMore, total?, cursor? }
    const page = await users.list({
      where: { role: 'admin' },
      orderBy: [{ column: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    // page.items: readonly Entity<S>[]  ·  page.hasMore: boolean
  })();
}
// #endregion snippet-4

// #region snippet-5
{
  class UserRepository extends BaseRepository<User> {
    static readonly schema = UserSchema;

    protected preInsert(row: Record<string, unknown>): void {
      console.log('about to insert', row);
    }

    protected postInsert(row: Record<string, unknown>): void {
      console.log('inserted', row);
      // Trigger welcome email, etc.
    }

    protected preUpdate(patch: Record<string, unknown>): void {
      // Validated, undefined-stripped, schema-ordered patch.
      // Branded expression objects are preserved by identity.
      console.log('about to update', patch);
    }

    protected preDelete(id: unknown): void {
      // Soft-delete check, cascade cleanup
    }

    protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
      // Filter sensitive fields, enrich data
      return rows.map(r => ({ ...r, viewedAt: new Date() }));
    }
  }
}
// #endregion snippet-5

// #region snippet-6
{
  (async () => {
    const tx = await pool.connect();
    await tx.query('BEGIN');

    try {
      const txRepo = users.withTransaction({ execute: tx.query.bind(tx) });
      const user = await txRepo.create({ email: 'a@b.com' });
      const order = await ordersRepo
        .withTransaction({ execute: tx.query.bind(tx) })
        .create({ userId: user.id, total: 100 });

      await tx.query('COMMIT');
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  })();
}
// #endregion snippet-6
