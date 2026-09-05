import type { Equal, Expect } from '../index.ts';
import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';
import type { KeysetListDTO, ListDTO, NonNullableEntityKeys } from './index.ts';

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  views: number & Sql<'integer'>;
  bio: (string & Sql<'text'>) | null;
  notes: (string & Sql<'text'>) | null;
}

// NonNullableEntityKeys extracts non-nullable columns ('id' | 'title' | 'views')
export type _Keys1 = Expect<Equal<NonNullableEntityKeys<Article>, 'id' | 'title' | 'views'>>;

// Valid keyset ListDTO with non-nullable sort column
export const _validKeysetList: ListDTO<Article> = {
  orderBy: [{ column: 'views', dir: 'desc' }],
  page: { limit: 10, after: { id: 1, views: 100 } },
};

// Valid offset ListDTO sorting on nullable column 'bio'
export const _validOffsetList: ListDTO<Article> = {
  orderBy: [{ column: 'bio', dir: 'asc' }],
  page: { limit: 10, offset: 0 },
};

export const _invalidKeysetOrderBy: KeysetListDTO<Article> = {
  // @ts-expect-error Keyset sorting on nullable column 'bio' must fail TypeScript compilation
  orderBy: [{ column: 'bio', dir: 'asc' }],
  page: { limit: 10, after: 'cursor-token' },
};

export const _invalidKeysetAfter: KeysetListDTO<Article> = {
  orderBy: [{ column: 'views', dir: 'desc' }],
  // @ts-expect-error Keyset cursor payload object containing nullable column 'bio' must fail TypeScript compilation
  page: { limit: 10, after: { bio: 'text' } },
};
