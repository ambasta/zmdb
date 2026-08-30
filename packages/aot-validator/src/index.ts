// @zmdb/aot-validator — implementation.
// #22 transformer scaffold + runtime-safety fallback implemented.

import { MAX_REGEX_CACHE_SIZE, safeTestPattern, validatePatternComplexity } from './regex-complexity.ts';
import { transformCode, escapePattern } from './transformer.ts';

export { ValidationError, getCachedRegExp, safeTestPattern, validatePatternComplexity } from './regex-complexity.ts';
export { transformCode, escapePattern };

export interface Rule {
  readonly kind: string;
  readonly args: readonly unknown[];
}

function rule(kind: string, ...args: readonly unknown[]): Rule {
  return Object.freeze({ kind, args: Object.freeze(args) });
}

export const tags = {
  Minimum(n: number): Rule {
    return rule('Minimum', n);
  },
  Maximum(n: number): Rule {
    return rule('Maximum', n);
  },
  MinLength(n: number): Rule {
    return rule('MinLength', n);
  },
  MaxLength(n: number): Rule {
    return rule('MaxLength', n);
  },
  Pattern(re: string): Rule {
    validatePatternComplexity(re);
    return rule('Pattern', re);
  },
  Enum(...values: readonly string[]): Rule {
    return rule('Enum', ...values);
  },
} as const;

// Caches for zero-allocation fallback validation.
const regexCache = new Map<string, RegExp>();
export function getRegExp(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (re) {
    regexCache.delete(pattern);
    regexCache.set(pattern, re);
    return re;
  }
  if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldestKey = regexCache.keys().next().value;
    if (oldestKey !== undefined) {
      regexCache.delete(oldestKey);
    }
  }
  re = new RegExp(pattern);
  regexCache.set(pattern, re);
  return re;
}

const enumSetCache = new WeakMap<readonly unknown[], Set<unknown>>();
export function getEnumSet(values: readonly unknown[]): Set<unknown> {
  let set = enumSetCache.get(values);
  if (!set) {
    set = new Set(values);
    enumSetCache.set(values, set);
  }
  return set;
}

// Runtime-safety fallback: identical boolean semantics to the inlined form.
// This is what executes pre-transform (dev / ts-node).
export function validate(r: Rule, expr: unknown): boolean {
  // `args` is `readonly unknown[]` (any package may define a kind), so the bound
  // is re-checked rather than asserted: `typeof arg === 'number'` costs nothing a
  // JIT can't fold, and this is the fallback path — the AOT emission is what the
  // benchmarks measure.
  const [arg] = r.args;
  switch (r.kind) {
    case 'Minimum':
      return typeof expr === 'number' && typeof arg === 'number' && expr >= arg;
    case 'Maximum':
      return typeof expr === 'number' && typeof arg === 'number' && expr <= arg;
    case 'MinLength':
      return typeof expr === 'string' && typeof arg === 'number' && expr.length >= arg;
    case 'MaxLength':
      return typeof expr === 'string' && typeof arg === 'number' && expr.length <= arg;
    case 'Pattern':
      return typeof expr === 'string' && safeTestPattern(r.args[0] as string, expr);
    case 'Enum':
      return getEnumSet(r.args).has(expr);
    default:
      throw new Error(`unknown rule kind: ${r.kind}`);
  }
}

export function transformSource(code: string): string {
  return transformCode(code);
}
