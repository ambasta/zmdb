import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver, type UpdatePatch } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, Populated, PrimaryKeyOf, UpdateDTO } from 'zmdb/derive';
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

// #endregion snippet-1

// #region snippet-2
export type LifecycleEvent =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete';

export interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}

class EventBus {
  subscribe(s: Subscriber): () => void; // returns an unsubscribe
  emit(event: LifecycleEvent, ctx: unknown): Promise<void>;
}
// #endregion snippet-2

// #region snippet-3
{
  const bus = new EventBus();

  const unsub = bus.subscribe({
    on: 'beforeCreate',
    run: ctx => {
      console.log('about to create', ctx);
    },
  });

  unsub(); // no longer called
}
// #endregion snippet-3

// #region snippet-4
{
  const bus = new EventBus();

  class UserRepository extends BaseRepository<User> {
    static override readonly schema = UserSchema;

    override async create(dto: CreateDTO<User>): Promise<Entity<User>> {
      await bus.emit('beforeCreate', dto);
      const created = await super.create(dto);
      await bus.emit('afterCreate', created);
      return created;
    }

    override async update(id: PrimaryKeyOf<User>, patch: UpdatePatch<User>): Promise<Entity<User> | undefined> {
      await bus.emit('beforeUpdate', { id, patch });
      const updated = await super.update(id, patch);
      await bus.emit('afterUpdate', updated);
      return updated;
    }

    override async delete(id: unknown): Promise<boolean> {
      await bus.emit('beforeDelete', { id });
      const deleted = await super.delete(id);
      await bus.emit('afterDelete', { id, deleted });
      return deleted;
    }
  }
}
// #endregion snippet-4

// #region snippet-5
{
  bus.subscribe({
    on: 'afterCreate',
    run: async ctx => {
      const user = assert<{ id: number; email: string }>(ctx);
      await audit.create({ action: 'create', entity: 'user', subject: user.id, at: new Date() });
    },
  });
}
// #endregion snippet-5

// #region snippet-6
{
  class TypedBus<T> {
    #subs: ((ctx: T) => void | Promise<void>)[] = [];
    on(fn: (ctx: T) => void | Promise<void>): () => void {
      return () => {};
    }
    async emit(ctx: T): Promise<void> {
      for (const fn of this.#subs) await fn(ctx);
    }
  }
}
// #endregion snippet-6

// #region snippet-7
{
  bus.subscribe({ on: 'beforeCreate', run: () => console.log('first') });
  bus.subscribe({ on: 'beforeCreate', run: () => console.log('second') });
}
// #endregion snippet-7

// #region snippet-8
{
  export interface User extends Table<'users'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    email: string & Sql<'text'>;
    deletedAt: (Date & Sql<'timestamp'>) | null;
  }

  const userSchema = schemaOf<User>();
}
// #endregion snippet-8

// #region snippet-9
{
  class UserRepository extends BaseRepository<User> {
    static override readonly schema = userSchema;

    async softDelete(id: number) {
      return this.update(id, { deletedAt: new Date() });
    }

    async findLive() {
      return this.find({ deletedAt: { isNull: true } });
    }
  }
}
// #endregion snippet-9

// #region snippet-10
{
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
// #endregion snippet-10
