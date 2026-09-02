import { describe, it, expect } from 'vitest';

import { type User } from './fixtures.ts';
import { applyOrderBy, applyPagination, type OrderByDTO, type PaginationDTO } from './index.ts';

// Fake builder recording orderBy/limit/offset calls.
function recorder() {
  const calls: [string, ...unknown[]][] = [];
  interface B {
    orderBy(c: string, d: string): B;
    limit(n: number): B;
    offset(n: number): B;
  }
  const mk = (): B => ({
    orderBy: (c: string, d: string) => (calls.push(['orderBy', c, d]), mk()),
    limit: (n: number) => (calls.push(['limit', n]), mk()),
    offset: (n: number) => (calls.push(['offset', n]), mk()),
  });
  return { b: mk(), calls };
}

describe('OrderByDTO + PaginationDTO (#182)', () => {
  it('applyOrderBy emits columns in array order; dir defaults asc', () => {
    const { b, calls } = recorder();
    const orderBy: OrderByDTO<User> = [{ column: 'age', dir: 'desc' }, { column: 'id' }];
    applyOrderBy(b, orderBy);
    expect(calls).toEqual([
      ['orderBy', 'age', 'desc'],
      ['orderBy', 'id', 'asc'],
    ]);
  });

  it('applyOrderBy undefined ⇒ no calls', () => {
    const { b, calls } = recorder();
    applyOrderBy(b, undefined);
    expect(calls).toEqual([]);
  });

  it('applyPagination offset ⇒ limit + offset', () => {
    const { b, calls } = recorder();
    const page: PaginationDTO<User> = { limit: 20, offset: 40 };
    applyPagination(b, page);
    expect(calls).toEqual([
      ['limit', 20],
      ['offset', 40],
    ]);
  });

  it('applyPagination limit-only ⇒ only limit (no offset)', () => {
    const { b, calls } = recorder();
    const page: PaginationDTO<User> = { limit: 20 };
    applyPagination(b, page);
    expect(calls).toEqual([['limit', 20]]);
  });

  it('applyPagination undefined ⇒ no calls', () => {
    const { b, calls } = recorder();
    applyPagination(b, undefined);
    expect(calls).toEqual([]);
  });
});
