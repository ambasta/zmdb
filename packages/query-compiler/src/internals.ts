import type { CompiledQuery } from './index.js';

export interface QuerySegments {
  readonly segments: readonly string[];
  readonly numbers: readonly number[];
}

export function getSegments(text: string): QuerySegments {
  const segments: string[] = [];
  const numbers: number[] = [];
  let lastIndex = 0;
  let idx = 0;
  while ((idx = text.indexOf('$', lastIndex)) !== -1) {
    let numEnd = idx + 1;
    while (numEnd < text.length && text.charCodeAt(numEnd) >= 48 && text.charCodeAt(numEnd) <= 57) {
      numEnd++;
    }
    if (numEnd === idx + 1) {
      lastIndex = idx + 1;
      continue;
    }
    segments.push(text.slice(lastIndex, idx));
    numbers.push(Number(text.slice(idx + 1, numEnd)));
    lastIndex = numEnd;
  }
  segments.push(text.slice(lastIndex));
  return { segments, numbers };
}

const compiledQuerySegmentsMap = new WeakMap<CompiledQuery, QuerySegments>();

export function getSegmentsForQuery(q: CompiledQuery): QuerySegments {
  const cached = compiledQuerySegmentsMap.get(q);
  if (cached) return cached;
  const segs = getSegments(q.text);
  compiledQuerySegmentsMap.set(q, segs);
  return segs;
}

export function createCompiledQuery(text: string, params: readonly unknown[]): CompiledQuery {
  const res = Object.freeze({ text, parameters: Object.freeze([...params]) });
  return res;
}
