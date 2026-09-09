// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regular expression syntax validation and a bounded compiled-RegExp cache.
//
// This validates syntax only; there is no static ReDoS analysis here, and the name is a
// leftover from when there was meant to be.
//
// There used to also be a `safeTestPattern` that refused inputs over 10 000 characters. It
// is gone, because the emitted form of the same check is `/pat/.test(x)` and has no such
// limit: keeping it meant one call site answering `false` after a build and throwing before
// one, which is precisely the divergence REQ-AV-4 exists to rule out. A cap that only one
// of the two paths can honour is not a safety feature.

import { ValidationError } from './index.js';

export { ValidationError };

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Invalid regular expression pattern: ${msg}`);
  }
}

export function validatePatternComplexity(pattern: string): void {
  compilePattern(pattern);
}

export const MAX_REGEX_CACHE_SIZE = 1000;
const patternCache = new Map<string, RegExp>();

export function getCachedRegExp(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (re) {
    patternCache.delete(pattern);
    patternCache.set(pattern, re);
    return re;
  }
  re = compilePattern(pattern);
  if (patternCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldestKey = patternCache.keys().next().value;
    if (oldestKey !== undefined) {
      patternCache.delete(oldestKey);
    }
  }
  patternCache.set(pattern, re);
  return re;
}
