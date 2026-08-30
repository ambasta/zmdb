import { describe, it, expect, expectTypeOf } from 'vitest';
import { buildSearchResult, type SearchDTO, type SearchHit } from './index.ts';
import { defineSchema, serial, text } from '../index.ts';

const DocSchema = defineSchema('docs', {
  id: serial().primaryKey(),
  body: text().notNull(),
});
type S = typeof DocSchema;

const hits = [
  { id: 1, body: 'alpha', _score: 0.9 },
  { id: 2, body: 'beta', _score: 0.5 },
  { id: 3, body: 'gamma', _score: 0.1 },
];

describe('SearchDTO (#171)', () => {
  it('preserves _score on hits and applies limit+1 trim', () => {
    const r = buildSearchResult(hits, { limit: 2 });
    expect(r.hasMore).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]._score).toBe(0.9);
  });

  it('projects hit fields by select (keeping _score)', () => {
    const r = buildSearchResult(hits, { limit: 5, select: ['id'] as const });
    expect(r.items[0]).toMatchObject({ id: 1 });
  });

  it('type-level: SearchDTO shape + SearchHit adds _score', () => {
    expectTypeOf<SearchDTO<S>['query']>().toEqualTypeOf<string>();
    expectTypeOf<SearchHit<{ id: number }>['_score']>().toEqualTypeOf<number | undefined>();
  });
});
