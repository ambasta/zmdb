import type { CompiledQuery } from '../index.js';

/** The closed sqlcommenter key set. */
export type CommentKey = 'traceparent' | 'controller' | 'action' | 'route' | 'framework';

/** Values available to one query execution. */
export type CommentPairs = Readonly<Partial<Record<CommentKey, string>>>;

/** A non-empty configured key list: absence, not an empty list, means off. */
export type CommentKeys = readonly [CommentKey, ...CommentKey[]];

interface ExecuteOptions {
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
}

const encode = (value: string): string => encodeURIComponent(value).replace(/'/g, "\\'");

/** Serialize the inside of a sqlcommenter block in deterministic key order. */
export function serializeComment(pairs: CommentPairs): string {
  return Object.entries(pairs)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${encode(key)}='${encode(value)}'`)
    .join(',');
}

/** Append one trailing sqlcommenter block, or return the original text unchanged. */
export function appendComment(text: string, pairs: CommentPairs): string {
  const serialized = serializeComment(pairs);
  return serialized.length === 0 ? text : `${text} /*${serialized}*/`;
}

/**
 * Render request-scoped comments at execution time without mutating or widening
 * the reusable compiled query.
 */
export function withComments<
  D extends {
    execute(query: CompiledQuery, options?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  },
>(driver: D, pairs: () => CommentPairs) {
  return {
    ...driver,
    execute(query: CompiledQuery, options?: ExecuteOptions): Promise<readonly Record<string, unknown>[]> {
      const text = appendComment(query.text, pairs());
      return driver.execute(text === query.text ? query : { ...query, text }, options);
    },
  };
}
