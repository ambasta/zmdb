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
    let qb = compiler.selectFrom('users');
    qb = applyOrderBy(qb, [{ column: 'createdAt', dir: 'desc' }], 'id');
    qb = applyPagination(qb, { limit: 21, offset: 40 }); // limit + 1

    const rows = await driver.execute(qb.compile());
    const result = buildListResult(rows, {
      limit: 20,
      orderBy: [{ column: 'createdAt', dir: 'desc' }, { column: 'id' }],
      pkColumn: 'id',
    });
  })();
}
// #endregion snippet-1

// #region snippet-2
{
  const order = [
    { column: 'createdAt', dir: 'desc' as const },
    { column: 'id', dir: 'asc' as const },
  ];

  let qb = compiler.selectFrom('users');
  qb = applyOrderBy(qb, order);
  qb = applyKeysetFilter(qb, decodeCursor(cursor), order, { active: { eq: true } });
  qb = applyPagination(qb, { limit: 21 });
}
// #endregion snippet-2

// #region snippet-3
{
  const cursor = encodeCursor({ createdAt: '2024-01-15T10:00:00Z', id: 123 });
  const values = decodeCursor(cursor); // throws on malformed input
}
// #endregion snippet-3

// #region snippet-4
interface ListResult<Row> {
  readonly items: readonly Row[];
  readonly total?: number; // only if you pass it in
  readonly hasMore: boolean; // from the limit + 1 fetch
  readonly cursor?: string; // encoded from the last kept row
}
// #endregion snippet-4

// #region snippet-5
{
  const result = buildListResult(rows, { limit: 20, orderBy, pkColumn: 'id' });
  // rows.length === 21 → hasMore = true, items = rows[0..19], cursor = encodeCursor(last kept row's sort keys)
  // rows.length <= 20  → hasMore = false, items = rows, cursor = undefined
}
// #endregion snippet-5

// #region snippet-6
{
  (async () => {
    const result = buildListResult(rows, { limit: 20, total: await countUsers(where) });
  })();
}
// #endregion snippet-6

// #region snippet-7
type OffsetPage = { limit: number; offset?: number | undefined };

type PaginationDTO<S> =
  | OffsetPage
  | { limit: number; after?: Partial<Entity<S>> | string; before?: Partial<Entity<S>> | string };
// #endregion snippet-7
