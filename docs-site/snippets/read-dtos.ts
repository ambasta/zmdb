import {
  applyOrderBy,
  applyPagination,
  buildListResult,
  buildSearchResult,
  compileWhere,
  project,
  type GetOptions,
  type ListDTO,
  type ListResult,
  type OrderByDTO,
  type PaginationDTO,
  type SearchDTO,
  type SearchResult,
  type WhereDTO,
} from '@zmdb/schema-core/dto';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  name?: string & Sql<'text'>;
  role: string & Sql<'text'>;
  age?: number & Sql<'integer'>;
  status?: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'>;
  deletedAt?: Date & Sql<'timestamp'>;
}

const rows = [] as any[];

// #region snippet-1
{
  const where: WhereDTO<User> = {
    role: 'admin', // eq shorthand
    age: { gte: 18, lt: 65 }, // operators
    email: { like: '%@corp.com' },
    status: { in: ['active', 'pending'] },
    deletedAt: { isNull: true },
  };
}
// #endregion snippet-1

// #region snippet-2
{
  const orderBy: OrderByDTO<User> = [
    { column: 'createdAt', dir: 'desc' },
    { column: 'id' }, // defaults to 'asc'
  ];
}
// #endregion snippet-2

// #region snippet-3
{
  // Offset pagination
  const offsetPage = { limit: 20, offset: 40 };

  // Cursor pagination (efficient for deep pages)
  const cursorPage: PaginationDTO<User> = {
    limit: 20,
    after: { createdAt: new Date('2024-01-15T10:00:00Z'), id: 123 },
  };
}
// #endregion snippet-3

// #region snippet-4
{
  const opts: GetOptions<User> = {
    select: ['id', 'email'] as const,
  };
  // Type narrows to Pick<Entity, 'id' | 'email'>
}
// #endregion snippet-4

// #region snippet-5
{
  const listDto: ListDTO<User> = {
    where: { role: 'admin' },
    orderBy: [{ column: 'createdAt', dir: 'desc' }],
    page: { limit: 20, offset: 0 },
    select: ['id', 'email', 'createdAt'] as const,
  };

  const result = buildListResult(rows, { limit: 20 });
  // result: { items, hasMore, total?, cursor? }
}
// #endregion snippet-5

// #region snippet-6
{
  const searchDto: SearchDTO<User> = {
    query: 'john smith',
    columns: ['email', 'name'],
    page: { limit: 10 },
    rank: true, // adds _score
  };

  const searchResult: SearchResult<User> = buildSearchResult(rows, { limit: 10 });
  // items have optional _score when rank: true
}
// #endregion snippet-6

// #region snippet-7
{
  const row = { id: 1, email: 'a@b.com', role: 'admin' };
  const narrow = project(row, ['email', 'role'] as const);
  // narrow: Pick<Row, 'email' | 'role'>
}
// #endregion snippet-7
