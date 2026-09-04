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
  (async () => {
    interface User extends Table<'users'> {
      id: number & Sql<'integer'> & Serial & PrimaryKey;
      orders?: Order[] & OneToMany<'orders', 'userId'>;
    }

    class UserRepository extends BaseRepository<User> {
      static override readonly schema = UserSchema;
    }

    const user = await users.findById(1, { populate: ['orders'] });
    // user.orders: readonly Entity<Order>[]   — to-one relations come back as Entity<Child> | null
  })();
}
// #endregion snippet-1

// #region snippet-2
{
  (async () => {
    // Given `user?: User & ManyToOne<'users', 'userId'>` on Order
    const orders = await ordersRepo.findJoined(
      { target: 'users', leftCol: 'userId', rightCol: 'id', kind: 'left' },
      { col: 'status', op: '=', value: 'pending' },
    );

    // Each order now has user data attached (flat object)
    for (const order of orders) {
      console.log(order.userId, order.user?.email);
    }
  })();
}
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    // Find all users, then batch-load their orders
    const usersWithOrders = await usersRepo.findAllWithMany(
      'orders', // relation name on User
      'orders', // child table
      'userId', // foreign key on orders
      'id', // parent key (default: 'id')
    );

    // usersWithOrders[0].orders = all orders where userId = user.id
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  (async () => {
    const result = await users.findById(1, { populate: ['orders'] });
    // result: Populated<User, 'orders'> | undefined
    // result.orders: readonly Entity<Order>[]
  })();
}
// #endregion snippet-4

// #region snippet-5
{
  (async () => {
    const user = await users.findById(1);
    // 'orders' in user === false — absent, not `undefined`, and not a key of the result type
  })();
}
// #endregion snippet-5
