// @zmdb/aot-validator — API stubs (red phase). Implementation in #22–#24.
// Also declares surfaces for advanced-validation (#45), serialization (#51),
// and validator-utilities (#56), whose specs live in ./advanced, ./serialization,
// ./utilities respectively.

const NOT_IMPL = 'not implemented';

// Primitive validation rule descriptors -------------------------------------
export interface Rule {
  readonly kind: string;
  readonly args: readonly unknown[];
}

export const tags = {
  Minimum(_n: number): Rule {
    throw new Error(NOT_IMPL);
  },
  Maximum(_n: number): Rule {
    throw new Error(NOT_IMPL);
  },
  MinLength(_n: number): Rule {
    throw new Error(NOT_IMPL);
  },
  MaxLength(_n: number): Rule {
    throw new Error(NOT_IMPL);
  },
  Pattern(_re: string): Rule {
    throw new Error(NOT_IMPL);
  },
  Enum(..._values: readonly string[]): Rule {
    throw new Error(NOT_IMPL);
  },
} as const;

// Runtime-safety fallback: boolean check pre-transform.
export function validate(_rule: Rule, _expr: unknown): boolean {
  throw new Error(NOT_IMPL);
}

// Transform harness (unit under #22): TS source string -> emitted JS.
export function transformSource(_code: string): string {
  throw new Error(NOT_IMPL);
}
