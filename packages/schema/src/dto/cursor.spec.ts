// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { applyOrderBy, applyKeysetFilter, type OrderTarget, type WhereTarget } from '@zmdb/orm/dto';
import {
  encodeCursor,
  decodeCursor,
  buildListResult,
  type OrderBySpec,
  type UnknownRow,
  type WhereDTO,
} from '@zmdb/schema/dto';
import { describe, it, expect, vi } from 'vitest';

// Fake recorder for testing builder method calls
function createWhereRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const mk = (): WhereTarget => ({
    where: (col: string, op: string, value: unknown) => (calls.push(['where', col, op, value]), mk()),
    orWhere: (col: string, op: string, value: unknown) => (calls.push(['orWhere', col, op, value]), mk()),
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
    const order = [
      { column: 'age', dir: 'desc' },
      { column: 'id', dir: 'asc' },
    ] as const;
    const token = (payload: unknown) => globalThis.Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    it('binds values to the exact ordered columns and directions', () => {
      const values = { age: 30, id: 100 };
      const cursor = encodeCursor(values, order);
      expect(decodeCursor(cursor, order)).toEqual(values);
      expect(() => decodeCursor(cursor, order.toReversed())).toThrow(/Invalid cursor/);
      expect(() => decodeCursor(cursor, [{ column: 'age', dir: 'asc' }, order[1]])).toThrow(/Invalid cursor/);
      expect(() => decodeCursor(cursor, [order[0]])).toThrow(/Invalid cursor/);
    });

    it('round-trips the complete scalar domain identically with Node and browser base64', () => {
      const values = {
        name: '東京 • café 😀',
        count: 12.5,
        enabled: false,
        id: 9007199254740993n,
        at: new Date('2026-09-09T12:34:56.789Z'),
      };
      const scalarOrder = Object.keys(values).map(column => ({ column, dir: 'asc' as const }));
      const nodeCursor = encodeCursor(values, scalarOrder);
      expect(decodeCursor(nodeCursor, scalarOrder)).toEqual(values);
      vi.stubGlobal('Buffer', undefined);
      try {
        const browserCursor = encodeCursor(values, scalarOrder);
        expect(browserCursor).toBe(nodeCursor);
        expect(decodeCursor(nodeCursor, scalarOrder)).toEqual(values);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('rejects missing, extra, nullish and unsupported ordered values', () => {
      const malformed = [
        { age: ['number', 30] },
        { age: ['number', 30], id: ['number', 100], extra: ['number', 1] },
        { age: ['number', 30], id: null },
        { age: ['number', 30], id: ['number', null] },
        { age: ['number', 30], id: ['date', 'invalid'] },
        { age: ['number', 30], id: ['bigint', '1.5'] },
        { age: ['number', 30], id: ['object', {}] },
      ];
      for (const values of malformed) {
        expect(() =>
          decodeCursor(
            token({
              order: [
                ['age', 'desc'],
                ['id', 'asc'],
              ],
              values,
            }),
            order,
          ),
        ).toThrow(/Invalid cursor/);
      }
      for (const id of [null, undefined, NaN, Infinity, new Date(NaN), {}, []]) {
        expect(() => encodeCursor({ age: 30, id }, order)).toThrow(/Invalid cursor/);
      }
      expect(() => encodeCursor({ age: 30 }, order)).toThrow(/Invalid cursor/);
      expect(() => encodeCursor({ age: 30, id: 1, extra: 2 }, order)).toThrow(/Invalid cursor/);
    });

    it('rejects malformed UTF-8, base64url, JSON and legacy tokens', () => {
      const valid = encodeCursor({ age: 30, id: 100 }, order);
      const invalid = [
        '',
        'not-valid-base64-json!!!',
        valid + '=',
        token([1, 2]),
        token({ age: 30, id: 100 }),
        globalThis.Buffer.from([0xff]).toString('base64url'),
      ];
      for (const cursor of invalid) expect(() => decodeCursor(cursor, order)).toThrow(/Invalid cursor/);
      // @ts-expect-error invalid input type
      expect(() => decodeCursor(123, order)).toThrow(/Invalid cursor/);
      vi.stubGlobal('Buffer', undefined);
      try {
        for (const cursor of invalid) expect(() => decodeCursor(cursor, order)).toThrow(/Invalid cursor/);
      } finally {
        vi.unstubAllGlobals();
      }
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
        orderBy: [
          { column: 'age', dir: 'desc' },
          { column: 'id', dir: 'asc' },
        ],
      });

      expect(res.hasMore).toBe(true);
      expect(res.items).toHaveLength(2);
      expect(res.cursor).toBeDefined();

      const decoded = decodeCursor(res.cursor!, [
        { column: 'age', dir: 'desc' },
        { column: 'id', dir: 'asc' },
      ]);
      expect(decoded).toEqual({ age: 25, id: 2 });
    });

    it('omits cursor when hasMore is false', () => {
      const rows = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
      ];
      const res = buildListResult(rows, {
        limit: 5,
        orderBy: [
          { column: 'age', dir: 'desc' },
          { column: 'id', dir: 'asc' },
        ],
      });

      expect(res.hasMore).toBe(false);
      expect(res.items).toHaveLength(2);
      expect(res.cursor).toBeUndefined();
    });
  });
});
