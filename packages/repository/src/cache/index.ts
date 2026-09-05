import { dialectName, type CompiledQuery, type DialectTarget } from '@zmdb/query-compiler';
import { isRecord } from '@zmdb/schema-core';
import type { SchemaIR } from '@zmdb/schema-core/ir';

export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number, tags: readonly string[]): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<void>;
}

export interface CacheOptions {
  readonly ttlMs: number;
  readonly tags?: readonly string[];
}

export interface CacheInvalidationOptions {
  readonly invalidateTags?: readonly string[];
}

interface MemoryEntry {
  readonly value: unknown;
  readonly expiresAt: number;
  readonly tags: readonly string[];
}

const DEFAULT_MAX_ENTRIES = 1_000;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('cache ttlMs must be a positive finite number');
  }
  return value;
}

/**
 * A process-local TTL store with bounded least-recently-used eviction.
 *
 * The default is deliberately finite. Expired entries are removed on access;
 * writes evict the oldest live-or-expired entry until the bound is restored.
 */
export function memoryStore(options?: { readonly maxEntries?: number }): CacheStore {
  const maxEntries = positiveInteger(options?.maxEntries ?? DEFAULT_MAX_ENTRIES, 'cache maxEntries');
  const entries = new Map<string, MemoryEntry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }

      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    async set(key, value, ttlMs, tags) {
      entries.delete(key);
      entries.set(key, {
        value,
        expiresAt: Date.now() + positiveDuration(ttlMs),
        tags: [...tags],
      });

      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },

    async invalidateTags(tags) {
      if (tags.length === 0) return;
      const invalidated = new Set(tags);
      for (const [key, entry] of entries) {
        if (entry.tags.some(tag => invalidated.has(tag))) entries.delete(key);
      }
    },
  };
}

function frame(tag: string, payload = ''): string {
  return `${tag}:${String(payload.length)}:${payload}`;
}

function binary(kind: string, value: Uint8Array): string {
  const encoded = [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return frame('x', frame('t', kind) + frame('v', encoded));
}

function taggedValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return frame('z');
  if (value === undefined) return frame('u');
  if (typeof value === 'string') return frame('s', value);
  if (typeof value === 'number') return frame('n', String(value));
  if (typeof value === 'bigint') return frame('i', String(value));
  if (typeof value === 'boolean') return frame('b', String(value));
  if (typeof value === 'symbol' || typeof value === 'function') {
    throw new TypeError(`cache keys cannot contain ${typeof value} values`);
  }

  if (value instanceof Date) return frame('d', String(value.getTime()));
  if (value instanceof ArrayBuffer) return binary('ArrayBuffer', new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return binary(
      Object.prototype.toString.call(value),
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  if (ancestors.has(value)) throw new TypeError('cache keys cannot contain cyclic values');
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return frame('a', value.map(item => frame('e', taggedValue(item, ancestors))).join(''));
    }
    if (value instanceof Map) {
      const pairs = [...value].map(
        ([key, item]) => frame('k', taggedValue(key, ancestors)) + frame('v', taggedValue(item, ancestors)),
      );
      return frame('m', pairs.toSorted().join(''));
    }
    if (value instanceof Set) {
      return frame(
        'q',
        [...value]
          .map(item => taggedValue(item, ancestors))
          .toSorted()
          .map(item => frame('e', item))
          .join(''),
      );
    }

    const kind = Object.prototype.toString.call(value);
    const properties = Object.keys(value)
      .toSorted()
      .map(key => frame('k', taggedValue(key, ancestors)) + frame('v', taggedValue(Reflect.get(value, key), ancestors)))
      .join('');
    return frame('o', frame('t', kind) + properties);
  } finally {
    ancestors.delete(value);
  }
}

function stableValue(value: unknown): string {
  return taggedValue(value, new Set());
}

function segment(name: string, value: unknown): string {
  return frame(name, stableValue(value));
}

export function resultCacheKey(input: {
  readonly dialect: DialectTarget;
  readonly schema: SchemaIR;
  readonly table: string;
  readonly filters?: readonly string[];
  readonly query: CompiledQuery;
}): string {
  return [
    'z1',
    segment('dialect', dialectName(input.dialect)),
    segment('fingerprint', input.schema),
    segment('table', input.table),
    segment('filters', input.filters ?? []),
    segment('text', input.query.text),
    segment('params', input.query.parameters),
  ].join('|');
}

export function cacheTags(table: string, callerTags: readonly string[] = []): readonly string[] {
  return [...new Set([`table:${table}`, ...callerTags])];
}

/** Fresh row and array identities without the cost or promise of a deep clone. */
export function copyCachedRows(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(row => (isRecord(row) ? { ...row } : row));
}
