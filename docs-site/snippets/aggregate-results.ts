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
  const spec: AggregateSpec<Order> = {
    groupBy: ['status'],
    computed: {
      orderCount: { fn: 'count' },
      totalRevenue: { fn: 'sum', column: 'totalPrice' },
      avgPrice: { fn: 'avg', column: 'totalPrice' },
      minOrder: { fn: 'min', column: 'totalPrice' },
      maxOrder: { fn: 'max', column: 'totalPrice' },
    },
  };
}
// #endregion snippet-1

// #region snippet-2
{
  (async () => {
    const results = await ordersRepo.aggregate(spec, agg =>
      agg
        .groupBy('status')
        .count('orderCount')
        .sum('totalRevenue', 'totalPrice')
        .avg('avgPrice', 'totalPrice')
        .min('minOrder', 'totalPrice')
        .max('maxOrder', 'totalPrice')
        .compile(),
    );
  })();
}
// #endregion snippet-2

// #region snippet-3
type OrderAgg = AggregateResult<Order, typeof spec>;
// {
//   status: 'pending' | 'shipped' | 'delivered';
//   orderCount: number;
//   totalRevenue: number | null;
//   avgPrice: number | null;
//   minOrder: number | null;
//   maxOrder: number | null;
// }
// #endregion snippet-3

// #region snippet-4
{
  (async () => {
    const totals = await ordersRepo.aggregate(
      {
        computed: {
          totalOrders: { fn: 'count' },
          revenue: { fn: 'sum', column: 'totalPrice' },
        },
      },
      agg => agg.count('totalOrders').sum('revenue', 'totalPrice').compile(),
    );

    // totals[0]: { totalOrders: number, revenue: number | null }
  })();
}
// #endregion snippet-4

// #region snippet-5
{
  (async () => {
    const recentStats = await ordersRepo.aggregate(
      {
        computed: { count: { fn: 'count' } },
      },
      agg => {
        // Filter first
        const q = qb.selectFrom('orders').where('createdAt', '>', '2024-01-01');
        // Then aggregate
        return agg.count('count').compile();
      },
    );
  })();
}
// #endregion snippet-5
