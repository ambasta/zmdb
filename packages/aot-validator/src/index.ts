// @zmdb/aot-validator — implementation.
// #22 transformer scaffold + runtime-safety fallback implemented.
// #23 (primitive tag inlining in transformSource) remains unimplemented:
// transformSource currently only performs the identity transform, so the
// inlining golden tests stay red until #23.

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
    return rule('Pattern', re);
  },
  Enum(...values: readonly string[]): Rule {
    return rule('Enum', ...values);
  },
} as const;

// Runtime-safety fallback: identical boolean semantics to the inlined form.
// This is what executes pre-transform (dev / ts-node).
export function validate(r: Rule, expr: unknown): boolean {
  switch (r.kind) {
    case 'Minimum':
      return typeof expr === 'number' && expr >= (r.args[0] as number);
    case 'Maximum':
      return typeof expr === 'number' && expr <= (r.args[0] as number);
    case 'MinLength':
      return typeof expr === 'string' && expr.length >= (r.args[0] as number);
    case 'MaxLength':
      return typeof expr === 'string' && expr.length <= (r.args[0] as number);
    case 'Pattern':
      return typeof expr === 'string' && new RegExp(r.args[0] as string).test(expr);
    case 'Enum':
      return r.args.includes(expr);
    default:
      throw new Error(`unknown rule kind: ${r.kind}`);
  }
}

// Transform harness (#22 scaffold): currently the identity transform.
// #23 will replace validate(tags.X(...), E) call expressions with inline JS.
export function transformSource(code: string): string {
  // Scaffold: no interception yet. Returns source unchanged so that code
  // WITHOUT validate() calls is provably untouched (the #22 identity contract).
  return code;
}
