import { describe, it, expect } from 'vitest';

import { quoteIdentifier, formatIdentifier, formatPlaceholder, renumberPlaceholders } from './dialect.ts';

describe('dialect formatting utility', () => {
  describe('quoteIdentifier', () => {
    it('quotes identifiers with double quotes for postgres and sqlite', () => {
      expect(quoteIdentifier('postgres', 'users')).toBe('"users"');
      expect(quoteIdentifier('sqlite', 'users')).toBe('"users"');
    });

    it('quotes identifiers with backticks for mysql', () => {
      expect(quoteIdentifier('mysql', 'users')).toBe('`users`');
    });

    it('leaves wildcard * unquoted', () => {
      expect(quoteIdentifier('postgres', '*')).toBe('*');
      expect(quoteIdentifier('mysql', '*')).toBe('*');
      expect(quoteIdentifier('sqlite', '*')).toBe('*');
    });
  });

  describe('formatIdentifier', () => {
    it('formats single identifiers', () => {
      expect(formatIdentifier('postgres', 'users')).toBe('"users"');
      expect(formatIdentifier('mysql', 'users')).toBe('`users`');
    });

    it('formats dot-qualified column references', () => {
      expect(formatIdentifier('postgres', 'users.id')).toBe('"users"."id"');
      expect(formatIdentifier('mysql', 'users.id')).toBe('`users`.`id`');
      expect(formatIdentifier('postgres', 'users.*')).toBe('"users".*');
    });

    it('formats table alias expressions', () => {
      expect(formatIdentifier('postgres', 'employees as e')).toBe('"employees" AS "e"');
      expect(formatIdentifier('mysql', 'employees as e')).toBe('`employees` AS `e`');
      expect(formatIdentifier('postgres', 'public.employees AS e')).toBe('"public"."employees" AS "e"');
    });
  });

  describe('formatPlaceholder', () => {
    it('generates stateful $n placeholders for postgres', () => {
      expect(formatPlaceholder('postgres', 1)).toBe('$1');
      expect(formatPlaceholder('postgres', 5)).toBe('$5');
    });

    it('generates stateless ? placeholders for mysql and sqlite', () => {
      expect(formatPlaceholder('mysql', 1)).toBe('?');
      expect(formatPlaceholder('sqlite', 3)).toBe('?');
    });
  });

  describe('renumberPlaceholders', () => {
    it('renumbers $n placeholders by applying offset', () => {
      const sql = 'SELECT * FROM "users" WHERE "id" = $1 AND "tenant_id" = $2';
      expect(renumberPlaceholders(sql, 2)).toBe('SELECT * FROM "users" WHERE "id" = $3 AND "tenant_id" = $4');
    });
  });
});
