import { isRecord, type ValidationIssue } from '@zmdb/schema-core';

// Advanced validation — implementation.
// #46 refinement compilation (refine + refinement-aware validateObject with
// exact error paths). Coercion + object strictness (#49) are co-implemented
// because the same validateObject drives them. #47 transform remains a rule
// constructor only; no validator path applies it.
import type { Rule } from '../index.js';

export type { ValidationIssue };

// #49 — branded (nominal) types. Compile-time only; erases to the base type at
// runtime (no footprint). `Brand<number, 'UserId'>` is assignable to `number`
// but distinct from `Brand<number, 'OrderId'>`.
declare const __brand: unique symbol;
export type Brand<Base, Tag extends string> = Base & { readonly [__brand]: Tag };

export type RefinePredicate = (v: unknown) => boolean;
export type TransformFn = (v: unknown) => unknown;

/**
 * A refinement rule: a real predicate plus its intrinsic source text for inspection.
 *
 * The predicate is passed in as a *function value*, not a source string that we
 * compile or interpret at import time. A string form creates a second executable
 * language whose property and call reachability must be secured; a function is
 * instead typechecked at the call site. `source` records the function's intrinsic
 * text for inspection; the current emitter does not consume advanced-rule source
 * (PRD §9.5).
 */
export interface RefineRule extends Rule {
  readonly kind: 'refine';
  readonly source: string;
  readonly message: string;
  readonly predicate: RefinePredicate;
}
/** A post-validation conversion. Same function-not-source rule as {@link RefineRule}. */
export interface TransformRule extends Rule {
  readonly kind: 'transform';
  readonly source: string;
  readonly apply: TransformFn;
}
export interface UnionRule extends Rule {
  readonly kind: 'union';
  readonly branches: readonly Rule[];
}
export interface DiscriminatedRule extends Rule {
  readonly kind: 'discriminated';
  readonly key: string;
  readonly map: Record<string, Rule>;
}

export function refine(predicate: RefinePredicate, message: string): RefineRule {
  if (typeof predicate !== 'function') {
    throw new TypeError('refine() requires a function value; source strings are not supported');
  }
  const source = Function.prototype.toString.call(predicate);
  return Object.freeze({
    kind: 'refine',
    args: Object.freeze([source, message]),
    source,
    message,
    predicate,
  } satisfies RefineRule);
}

export function transform(apply: TransformFn): TransformRule {
  if (typeof apply !== 'function') {
    throw new TypeError('transform() requires a function value; source strings are not supported');
  }
  const source = Function.prototype.toString.call(apply);
  return Object.freeze({
    kind: 'transform',
    args: Object.freeze([source]),
    source,
    apply,
  } satisfies TransformRule);
}

export function union(...rules: readonly Rule[]): UnionRule {
  return Object.freeze({ kind: 'union', args: Object.freeze(rules), branches: rules } satisfies UnionRule);
}

export function discriminated(key: string, map: Record<string, Rule>): DiscriminatedRule {
  return Object.freeze({
    kind: 'discriminated',
    args: Object.freeze([key]),
    key,
    map,
  } satisfies DiscriminatedRule);
}

// `Rule` is an open interface (any package may add a kind), so `rule.kind === x`
// cannot narrow it the way a closed union would. These guards check the tag *and*
// the payload it implies, which is what makes the narrowing sound without a cast.
function isRefine(rule: Rule): rule is RefineRule {
  return rule.kind === 'refine' && 'predicate' in rule && typeof rule.predicate === 'function';
}
function isUnion(rule: Rule): rule is UnionRule {
  return rule.kind === 'union' && 'branches' in rule && Array.isArray(rule.branches);
}
function isDiscriminated(rule: Rule): rule is DiscriminatedRule {
  return rule.kind === 'discriminated' && 'key' in rule && typeof rule.key === 'string' && 'map' in rule;
}

// Runtime evaluator for the rule-value API. The type-first emitter is a separate path.
export function evalRule(rule: Rule, value: unknown): boolean {
  if (isUnion(rule)) return rule.branches.some(b => evalRule(b, value));
  if (isDiscriminated(rule)) {
    if (!isRecord(value)) return false;
    const disc = value[rule.key];
    if (typeof disc !== 'string') return false;
    const branch = rule.map[disc];
    if (!branch) return false;
    return evalRule(branch, value.value);
  }
  return checkRule(rule, value).ok;
}

export const coerce = {
  number(expr: unknown): number {
    const n = Number(expr);
    if (Number.isNaN(n)) throw new TypeError(`cannot coerce to number: ${String(expr)}`);
    return n;
  },
} as const;

export type ObjectMode = 'strict' | 'strip' | 'passthrough';

function checkRule(rule: Rule, value: unknown): { ok: boolean; expected: string; message: string } {
  // Refinement rule.
  if (isRefine(rule)) {
    return { ok: rule.predicate(value), expected: rule.source, message: rule.message };
  }
  // Primitive tag rules (mirror the aot-validator runtime fallback).
  const [arg] = rule.args;
  switch (rule.kind) {
    case 'Min':
      return {
        ok: typeof value === 'number' && typeof arg === 'number' && value >= arg,
        expected: `number >= ${String(arg)}`,
        message: `must be >= ${String(arg)}`,
      };
    case 'MaxLength':
      return {
        ok: typeof value === 'string' && typeof arg === 'number' && value.length <= arg,
        expected: `string length <= ${String(arg)}`,
        message: `length must be <= ${String(arg)}`,
      };
    default:
      return { ok: true, expected: rule.kind, message: '' };
  }
}

export interface ValidateObjectResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues: readonly ValidationIssue[];
  /** @deprecated Use `issues` instead. */
  readonly errors?: readonly ValidationIssue[];
}

export function validateObject<T = unknown>(
  value: unknown,
  rules: Record<string, Rule>,
  mode: ObjectMode,
): ValidateObjectResult<T> {
  const issues: ValidationIssue[] = [];
  const obj = isRecord(value) ? value : {};

  let data: unknown = undefined;
  if (isRecord(value)) {
    if (mode === 'strip') {
      const stripped: Record<string, unknown> = {};
      for (const key of Object.keys(rules)) {
        if (key in obj) {
          stripped[key] = obj[key];
        }
      }
      data = stripped;
    } else {
      data = { ...obj };
    }
  }

  // Excess-key handling for strict mode.
  if (mode === 'strict') {
    for (const key of Object.keys(obj)) {
      if (!(key in rules)) {
        issues.push({
          path: `input.${key}`,
          expected: 'no excess property',
          value: obj[key],
          message: `unexpected property "${key}"`,
        });
      }
    }
  }

  for (const [key, rule] of Object.entries(rules)) {
    const res = checkRule(rule, obj[key]);
    if (!res.ok) {
      issues.push({ path: `input.${key}`, expected: res.expected, value: obj[key], message: res.message });
    }
  }

  const result: ValidateObjectResult<T> = {
    success: issues.length === 0,
    ...(data !== undefined ? { data: data as T } : {}),
    issues,
  };

  Object.defineProperty(result, 'errors', {
    get() {
      console.warn('DeprecationWarning: "errors" property is deprecated, use "issues" instead.');
      return this.issues;
    },
    enumerable: true,
    configurable: true,
  });

  return result;
}
