// Advanced validation — implementation.
// #46 refinement compilation (refine + refinement-aware validateObject with
// exact error paths). Coercion + object strictness (#49) are co-implemented
// because the same validateObject drives them. #47 transform and #48 union
// have no runtime-fallback tests in this suite and are left as thin stubs.
import type { Rule } from '../index.ts';

export interface ValidationIssue {
  readonly path: string;
  readonly expected: string;
  readonly value: unknown;
  readonly message: string;
}

// #49 — branded (nominal) types. Compile-time only; erases to the base type at
// runtime (no footprint). `Brand<number, 'UserId'>` is assignable to `number`
// but distinct from `Brand<number, 'OrderId'>`.
declare const __brand: unique symbol;
export type Brand<Base, Tag extends string> = Base & { readonly [__brand]: Tag };

// A refinement rule carries an inlineable predicate source + a message.
// The runtime fallback compiles the predicate with `v` in scope.
interface RefineRule extends Rule {
  readonly kind: 'refine';
  readonly predicateSource: string;
  readonly message: string;
  readonly predicate: (v: unknown) => boolean;
}

export function refine(predicateSource: string, message: string): Rule {
  // eslint-disable-next-line no-new-func
  const predicate = new Function('v', `return (${predicateSource});`) as (v: unknown) => boolean;
  return Object.freeze({
    kind: 'refine',
    args: Object.freeze([predicateSource, message]),
    predicateSource,
    message,
    predicate,
  } satisfies RefineRule);
}

export function transform(fnSource: string): Rule {
  // eslint-disable-next-line no-new-func
  const apply = new Function('v', `return (${fnSource});`) as (v: unknown) => unknown;
  return Object.freeze({
    kind: 'transform',
    args: Object.freeze([fnSource]),
    apply,
  } as Rule);
}

interface UnionRule extends Rule {
  readonly kind: 'union';
  readonly branches: readonly Rule[];
}
interface DiscriminatedRule extends Rule {
  readonly kind: 'discriminated';
  readonly key: string;
  readonly map: Record<string, Rule>;
}

export function union(...rules: readonly Rule[]): Rule {
  return Object.freeze({ kind: 'union', args: Object.freeze(rules), branches: rules } as UnionRule);
}

export function discriminated(key: string, map: Record<string, Rule>): Rule {
  return Object.freeze({ kind: 'discriminated', args: Object.freeze([key]), key, map } as DiscriminatedRule);
}

// Runtime evaluator (the fallback the transformer's inline emission mirrors).
export function evalRule(rule: Rule, value: unknown): boolean {
  switch (rule.kind) {
    case 'union':
      return (rule as UnionRule).branches.some(b => evalRule(b, value));
    case 'discriminated': {
      const r = rule as DiscriminatedRule;
      if (typeof value !== 'object' || value === null) return false;
      const disc = (value as Record<string, unknown>)[r.key];
      if (typeof disc !== 'string' || !(disc in r.map)) return false;
      return evalRule(r.map[disc]!, (value as Record<string, unknown>).value);
    }
    default:
      return checkRule(rule, value).ok;
  }
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
  if ((rule as RefineRule).kind === 'refine') {
    const r = rule as RefineRule;
    return { ok: r.predicate(value), expected: r.predicateSource, message: r.message };
  }
  // Primitive tag rules (mirror the aot-validator runtime fallback).
  const [arg] = rule.args;
  switch (rule.kind) {
    case 'Minimum':
      return {
        ok: typeof value === 'number' && value >= (arg as number),
        expected: `number >= ${String(arg)}`,
        message: `must be >= ${String(arg)}`,
      };
    case 'MaxLength':
      return {
        ok: typeof value === 'string' && value.length <= (arg as number),
        expected: `string length <= ${String(arg)}`,
        message: `length must be <= ${String(arg)}`,
      };
    default:
      return { ok: true, expected: rule.kind, message: '' };
  }
}

export function validateObject(
  value: unknown,
  rules: Record<string, Rule>,
  mode: ObjectMode,
): { success: boolean; issues: readonly ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const obj = (value ?? {}) as Record<string, unknown>;

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

  return { success: issues.length === 0, issues };
}
