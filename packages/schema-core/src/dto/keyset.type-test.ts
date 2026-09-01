import type { Equal, Expect } from '../index.ts';
import { defineSchema, integer, notNull, primaryKey, serial, text } from '../index.ts';
import type { KeysetListDTO, ListDTO, NonNullableEntityKeys } from './index.ts';

const ArticleSchema = defineSchema('articles', {
  id: primaryKey(serial()),
  title: notNull(text()),
  views: notNull(integer()),
  bio: text().nullable(),
  notes: text().nullable(),
});

type ArticleS = typeof ArticleSchema;

// NonNullableEntityKeys extracts non-nullable columns ('id' | 'title' | 'views')
export type _Keys1 = Expect<Equal<NonNullableEntityKeys<ArticleS>, 'id' | 'title' | 'views'>>;

// Valid keyset ListDTO with non-nullable sort column
export const _validKeysetList: ListDTO<ArticleS> = {
  orderBy: [{ column: 'views', dir: 'desc' }],
  page: { limit: 10, after: { id: 1, views: 100 } },
};

// Valid offset ListDTO sorting on nullable column 'bio'
export const _validOffsetList: ListDTO<ArticleS> = {
  orderBy: [{ column: 'bio', dir: 'asc' }],
  page: { limit: 10, offset: 0 },
};

export const _invalidKeysetOrderBy: KeysetListDTO<ArticleS> = {
  // @ts-expect-error Keyset sorting on nullable column 'bio' must fail TypeScript compilation
  orderBy: [{ column: 'bio', dir: 'asc' }],
  page: { limit: 10, after: 'cursor-token' },
};

export const _invalidKeysetAfter: KeysetListDTO<ArticleS> = {
  orderBy: [{ column: 'views', dir: 'desc' }],
  // @ts-expect-error Keyset cursor payload object containing nullable column 'bio' must fail TypeScript compilation
  page: { limit: 10, after: { bio: 'text' } },
};
