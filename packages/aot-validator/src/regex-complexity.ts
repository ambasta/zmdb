// Regular expression syntax validator and bounded fallback evaluator.
// Maintains a bounded compiled-RegExp cache and validates pattern syntax.
// Note: This validates regex syntax only and does not perform static ReDoS complexity analysis.

import { ValidationError } from '@zmdb/schema-core';

export { ValidationError };

export function validatePatternComplexity(pattern: string): void {
  try {
    RegExp(pattern);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Invalid regular expression pattern: ${msg}`);
  }
}

const MAX_FALLBACK_INPUT_LENGTH = 10000;
export const MAX_REGEX_CACHE_SIZE = 1000;
const patternCache = new Map<string, RegExp>();

export function getCachedRegExp(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (re) {
    patternCache.delete(pattern);
    patternCache.set(pattern, re);
    return re;
  }
  validatePatternComplexity(pattern);
  if (patternCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldestKey = patternCache.keys().next().value;
    if (oldestKey !== undefined) {
      patternCache.delete(oldestKey);
    }
  }
  re = new RegExp(pattern);
  patternCache.set(pattern, re);
  return re;
}

export function safeTestPattern(pattern: string, input: string, maxInputLength = MAX_FALLBACK_INPUT_LENGTH): boolean {
  if (input.length > maxInputLength) {
    throw new ValidationError(
      `Input length (${input.length}) exceeds maximum limit (${maxInputLength}) for pattern evaluation`,
    );
  }
  const re = getCachedRegExp(pattern);
  return re.test(input);
}
