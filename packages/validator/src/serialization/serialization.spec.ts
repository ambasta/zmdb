import { stringify, parse } from '@zmdb/validator/serialization';
import { describe, it, expect } from 'vitest';

// RED PHASE (#51 spec freeze): serializer correctness vs JSON.

describe('stringify correctness', () => {
  const fixtures: unknown[] = [
    { id: 1, name: 'alice', active: true },
    { nested: { a: [1, 2, 3], b: null } },
    'string with "quotes" and \\backslash',
    [1, 'two', false, null],
    { withUndefined: undefined, kept: 1 },
  ];

  for (const [i, v] of fixtures.entries()) {
    it(`fixture ${i} matches JSON.stringify`, () => {
      expect(stringify(v)).toBe(JSON.stringify(v));
    });

    it(`fixture ${i} round-trips`, () => {
      expect(JSON.parse(stringify(v))).toEqual(JSON.parse(JSON.stringify(v)));
    });
  }

  it('bigint throws TypeError (documented policy)', () => {
    expect(() => stringify({ big: 1n })).toThrow(TypeError);
  });

  it('rejects root, array, boxed and toJSON-produced bigints', () => {
    for (const value of [1n, [1n], Object(1n), { toJSON: () => 1n }]) {
      expect(() => stringify(value)).toThrow(TypeError);
    }
  });

  it('keeps the root-bigint refusal while honoring nested bigint toJSON', () => {
    const previous = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON');
    // oxlint-disable-next-line no-extend-native -- Exercise the native hook and restore its descriptor in finally.
    Object.defineProperty(BigInt.prototype, 'toJSON', { configurable: true, value: () => 'converted' });
    try {
      expect(() => stringify(1n)).toThrow(TypeError);
      expect(stringify({ value: 1n })).toBe('{"value":"converted"}');
      expect(stringify(Object(1n))).toBe('"converted"');
    } finally {
      if (previous === undefined) Reflect.deleteProperty(BigInt.prototype, 'toJSON');
      else {
        // oxlint-disable-next-line no-extend-native -- Restore the exact descriptor replaced by this test.
        Object.defineProperty(BigInt.prototype, 'toJSON', previous);
      }
    }
  });

  it('preserves native property, proxy and toJSON observations without a preliminary walk', () => {
    function fixture() {
      const events: string[] = [];
      const value = new Proxy(
        {
          extra: 'retained',
          get child() {
            events.push('getter:child');
            return {
              toJSON(key: string) {
                events.push(`toJSON:${key}`);
                return { value: 2 };
              },
            };
          },
          omitted: undefined,
        },
        {
          get(target, key, receiver) {
            events.push(`get:${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          ownKeys(target) {
            events.push('ownKeys');
            return Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, key) {
            events.push(`descriptor:${String(key)}`);
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      return { value, events };
    }
    const native = fixture();
    const actual = fixture();
    expect(stringify(actual.value)).toBe(JSON.stringify(native.value));
    expect(actual.events).toEqual(native.events);
  });

  it('preserves thrown user errors, including bigint-like TypeErrors', () => {
    const failure = new TypeError('Do not know how to serialize a BigInt');
    for (const value of [
      {
        get field() {
          throw failure;
        },
      },
      {
        toJSON() {
          throw failure;
        },
      },
    ]) {
      let caught: unknown;
      try {
        stringify(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
    }
  });

  it('preserves native omissions, non-finite numbers, dates and circular refusal', () => {
    for (const value of [
      undefined,
      Symbol('root'),
      () => undefined,
      { z: undefined, extra: 1, date: new Date('2026-09-08T00:00:00Z'), number: NaN },
      [undefined, Symbol('item'), Infinity, -Infinity, -0],
    ])
      expect(stringify(value)).toBe(JSON.stringify(value));
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => stringify(circular)).toThrow(TypeError);
  });
});

describe('parse', () => {
  it('valid JSON yields success + data', () => {
    const r = parse<{ a: number }>('{"a":1}');
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ a: 1 });
  });

  it('malformed JSON yields success:false', () => {
    const r = parse('{not json');
    expect(r.success).toBe(false);
  });
});
