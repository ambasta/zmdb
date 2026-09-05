import { describe, expect, it } from 'vitest';

import { resolveNaming, snakeCase, snakeCasePlural, type NamingStrategy } from './index.js';

describe('built-in naming strategies', () => {
  it('snake_cases the names every hand-rolled implementation gets wrong', () => {
    expect(
      ['createdAt', 'HTTPStatus', 'id2', 'userID'].map(name => snakeCase.column?.(name, { table: 'users' })),
    ).toEqual(['created_at', 'http_status', 'id2', 'user_id']);
    expect(snakeCase.table?.('UserAccount')).toBe('user_account');
    expect(snakeCase.index?.('UserAccount', ['createdAt'], false)).toBe('user_account_created_at_idx');
  });

  it('is idempotent on a name that is already snake_case', () => {
    expect(snakeCase.column?.('already_snake_case', { table: 'users' })).toBe('already_snake_case');
    expect(snakeCase.table?.('user_accounts')).toBe('user_accounts');
  });

  it('pluralises from an explicit rule set, and leaves an unknown word alone', () => {
    expect(
      ['userAccount', 'blogPost', 'person', 'status', 'category', 'matrix', 'metadata'].map(name =>
        snakeCasePlural.table?.(name),
      ),
    ).toEqual(['user_accounts', 'blog_posts', 'people', 'statuses', 'categories', 'matrices', 'metadata']);
    expect(snakeCasePlural.table?.('user_accounts')).toBe('user_accounts');
    expect(snakeCasePlural.index?.('userAccount', ['createdAt'], true)).toBe('user_accounts_created_at_uniq');
  });

  it('resolves a strategy name from config, and a function as itself', () => {
    const custom: NamingStrategy = { table: declared => `custom_${declared}` };
    expect(resolveNaming('snake_case')).toBe(snakeCase);
    expect(resolveNaming('snake_case_plural')).toBe(snakeCasePlural);
    expect(resolveNaming(custom)).toBe(custom);
    expect(resolveNaming(undefined)).toEqual({});
  });
});
