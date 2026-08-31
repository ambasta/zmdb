// @zmdb/aot-validator — the runtime half.
//
// Nothing reachable from this entry point may import `typescript`. The compiler is a
// 100 MB build-time dependency, and an application that imports `tags` to declare a
// constraint should not pull it into a browser bundle. `transformCode` and
// `transformFile` therefore live in `./transformer.ts` and are reached through the
// `./plugin` and `./transformer` subpaths, which are build-time by contract;
// `.github/scripts/verify-exports.mjs` enforces the split.

import { getCachedRegExp, MAX_REGEX_CACHE_SIZE, validatePatternComplexity } from './regex-complexity.js';

export { AssertError, failWith } from './errors.js';
export { ValidationError, getCachedRegExp, validatePatternComplexity } from './regex-complexity.js';

export interface Rule {
  readonly kind: string;
  readonly args: readonly unknown[];
}

function rule(kind: string, ...args: readonly unknown[]): Rule {
  return Object.freeze({ kind, args: Object.freeze(args) });
}

// One spelling per constraint, and it is the tag's. `Min`/`Max` used to be `Minimum`/
// `Maximum` here while the type-level tag has always been `Min<N>`/`Max<N>`, which left
// `ir/index.ts` folding case *and* mapping two names onto one kind. Now that a constraint
// is declared as `number & Min<18>`, the `tags.Min(18)` call has no declaration role
// left — the `Rule` object is the AOT's pre-transform fallback representation — so the
// name that stays is the one you write in a type.
export const tags = {
  Min(n: number): Rule {
    return rule('Min', n);
  },
  Max(n: number): Rule {
    return rule('Max', n);
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
    case 'Min':
      return typeof expr === 'number' && typeof arg === 'number' && expr >= arg;
    case 'Max':
      return typeof expr === 'number' && typeof arg === 'number' && expr <= arg;
    case 'MinLength':
      return typeof expr === 'string' && typeof arg === 'number' && expr.length >= arg;
    case 'MaxLength':
      return typeof expr === 'string' && typeof arg === 'number' && expr.length <= arg;
    case 'Pattern':
      // No input-length cap. There used to be one — 10 000 characters, and a throw past it
      // — but the inlined form is `/pat/.test(x)` with no such limit, so the same call
      // answered `false` in a build and threw in dev. REQ-AV-4 does not allow that, and of
      // the two behaviours the cap is the one with no counterpart to move it to.
      // Re-checked, not asserted, for the reason above: an unchecked `args[0]` would have
      // reached `new RegExp` and been coerced, so `Pattern` with a number in it compiled a
      // pattern rather than answering `false` like every other rule with a bad argument.
      return typeof expr === 'string' && typeof arg === 'string' && getCachedRegExp(arg).test(expr);
    case 'Enum':
      return getEnumSet(r.args).has(expr);
    case 'refine': {
      const pred = (r as unknown as { predicate?: (v: unknown) => boolean }).predicate;
      return typeof pred === 'function' ? Boolean(pred(expr)) : true;
    }
    default:
      throw new Error(`unknown rule kind: ${r.kind}`);
  }
}
