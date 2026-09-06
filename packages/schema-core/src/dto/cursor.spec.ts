import { describe, it, expect } from 'vitest';

import {
  encodeCursor,
  decodeCursor,
  applyOrderBy,
  applyKeysetFilter,
  buildListResult,
  type OrderBySpec,
  type UnknownRow,
  type WhereDTO,
  type OrderTarget,
  type WhereTarget,
} from './index.js';

// Fake recorder for testing builder method calls
function createWhereRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const mk = (): WhereTarget => ({
    where: (col: string, op: unknown, value: unknown) => (calls.push(['where', col, op, value]), mk()),
    orWhere: (col: string, op: unknown, value: unknown) => (calls.push(['orWhere', col, op, value]), mk()),
  });
  return { builder: mk(), calls };
}

function createOrderRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const mk = (): OrderTarget => ({
    orderBy: (col: string, dir: string) => (calls.push(['orderBy', col, dir]), mk()),
    limit: (n: number) => (calls.push(['limit', n]), mk()),
    offset: (n: number) => (calls.push(['offset', n]), mk()),
  });
  return { builder: mk(), calls };
}

describe('Composite Keyset Cursor Utilities', () => {
  describe('encodeCursor & decodeCursor', () => {
    it('encodes and decodes valid payloads', () => {
      const payload = { age: 30, id: 100 };
      const cursor = encodeCursor(payload);
      expect(typeof cursor).toBe('string');
      expect(cursor).not.toBe('');
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(payload);
    });

    it('throws on empty or non-string input', () => {
      expect(() => decodeCursor('')).toThrow(/Invalid cursor/);
      // @ts-expect-error invalid input type
      expect(() => decodeCursor(123)).toThrow(/Invalid cursor/);
    });

    it('throws clear validation error on malformed base64 / JSON string', () => {
      expect(() => decodeCursor('not-valid-base64-json!!!')).toThrow(/Invalid cursor/);
      const badJsonCursor = encodeCursor('not json' as unknown as Record<string, unknown>);
      expect(() => decodeCursor(badJsonCursor)).toThrow(/Invalid cursor/);
    });

    it('throws when decoded JSON is not an object', () => {
      const arrayCursor = encodeCursor([1, 2, 3] as unknown as Record<string, unknown>);
      expect(() => decodeCursor(arrayCursor)).toThrow(/Invalid cursor/);
    });
  });

  describe('applyOrderBy with PK tie-breaker', () => {
    it('appends pkColumn as tie-breaker when not in orderBy', () => {
      const { builder, calls } = createOrderRecorder();
      const order: OrderBySpec = [{ column: 'age', dir: 'desc' }];
      applyOrderBy(builder, order, 'id');
      expect(calls).toEqual([
        ['orderBy', 'age', 'desc'],
        ['orderBy', 'id', 'asc'],
      ]);
    });

    it('does not duplicate pkColumn if already present in orderBy', () => {
      const { builder, calls } = createOrderRecorder();
      const order: OrderBySpec = [
        { column: 'age', dir: 'desc' },
        { column: 'id', dir: 'desc' },
      ];
      applyOrderBy(builder, order, 'id');
      expect(calls).toEqual([
        ['orderBy', 'age', 'desc'],
        ['orderBy', 'id', 'desc'],
      ]);
    });

    it('defaults to pkColumn ASC when orderBy is undefined', () => {
      const { builder, calls } = createOrderRecorder();
      applyOrderBy(builder, undefined, 'id');
      expect(calls).toEqual([['orderBy', 'id', 'asc']]);
    });
  });

  describe('applyKeysetFilter', () => {
    // A composite sort with one descending and one ascending column: enough to
    // pin both inequality directions and the tie-break branch.
    const orderBy: OrderBySpec = [
      { column: 'age', dir: 'desc' },
      { column: 'id', dir: 'asc' },
    ];
    const cursorValues = { age: 30, id: 100 };

    it('constructs multi-column inequality conditions for composite sort (age DESC, id ASC)', () => {
      const { builder, calls } = createWhereRecorder();

      applyKeysetFilter(builder, cursorValues, orderBy);

      expect(calls).toEqual([
        ['where', 'age', '<', 30],
        ['orWhere', 'age', '=', 30],
        ['where', 'id', '>', 100],
      ]);
    });

    it('combines with userWhere filtering', () => {
      const { builder, calls } = createWhereRecorder();
      const userWhere = { status: 'active' } as WhereDTO<UnknownRow>;

      applyKeysetFilter(builder, cursorValues, orderBy, userWhere);

      expect(calls).toEqual([
        ['where', 'status', '=', 'active'],
        ['where', 'age', '<', 30],
        ['orWhere', 'status', '=', 'active'],
        ['where', 'age', '=', 30],
        ['where', 'id', '>', 100],
      ]);
    });

    it('throws error if a sort column is missing from cursorValues', () => {
      const { builder } = createWhereRecorder();

      expect(() => applyKeysetFilter(builder, { age: 30 }, orderBy)).toThrow(
        /Invalid cursor: missing value for column "id"/,
      );
    });
  });

  describe('buildListResult cursor derivation', () => {
    it('includes opaque cursor when hasMore is true', () => {
      const rows = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
        { id: 3, name: 'Charlie', age: 20 },
      ];
      const res = buildListResult(rows, {
        limit: 2,
        orderBy: [{ column: 'age', dir: 'desc' }],
        pkColumn: 'id',
      });

      expect(res.hasMore).toBe(true);
      expect(res.items).toHaveLength(2);
      expect(res.cursor).toBeDefined();

      const decoded = decodeCursor(res.cursor!);
      expect(decoded).toEqual({ age: 25, id: 2 });
    });

    it('omits cursor when hasMore is false', () => {
      const rows = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
      ];
      const res = buildListResult(rows, {
        limit: 5,
        orderBy: [{ column: 'age', dir: 'desc' }],
        pkColumn: 'id',
      });

      expect(res.hasMore).toBe(false);
      expect(res.items).toHaveLength(2);
      expect(res.cursor).toBeUndefined();
    });
  });
});
