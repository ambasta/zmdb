// Advanced validation — API stubs (red phase). Implementation in #46–#50.
import type { Rule } from '../index.ts';

const NOT_IMPL = 'not implemented';

export interface ValidationIssue {
  readonly path: string;
  readonly expected: string;
  readonly value: unknown;
  readonly message: string;
}

export function refine(_predicateSource: string, _message: string): Rule {
  throw new Error(NOT_IMPL);
}

export function transform(_fnSource: string): Rule {
  throw new Error(NOT_IMPL);
}

export function union(..._rules: readonly Rule[]): Rule {
  throw new Error(NOT_IMPL);
}

export function discriminated(_key: string, _map: Record<string, Rule>): Rule {
  throw new Error(NOT_IMPL);
}

export const coerce = {
  number(_expr: unknown): number {
    throw new Error(NOT_IMPL);
  },
} as const;

export type ObjectMode = 'strict' | 'strip' | 'passthrough';

// Validate an object at runtime (fallback), collecting structured issues.
export function validateObject(
  _value: unknown,
  _rules: Record<string, Rule>,
  _mode: ObjectMode,
): { success: boolean; issues: readonly ValidationIssue[] } {
  throw new Error(NOT_IMPL);
}
