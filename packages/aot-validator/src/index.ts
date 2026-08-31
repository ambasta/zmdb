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
      return typeof expr === 'string' && typeof arg === 'string' && new RegExp(arg).test(expr);
    case 'Enum':
      return r.args.includes(expr);
    default:
      throw new Error(`unknown rule kind: ${r.kind}`);
  }
}

// Transform harness (#22 scaffold): currently the identity transform.
// #23: replace validate(tags.X(...), E) call expressions with inline JS.
// A focused inliner: it scans for `validate(` calls, splits the two arguments
// on the top-level comma, parses the `tags.KIND(args)` first argument, and
// emits an allocation-free inline boolean for the checked expression E.
export function transformSource(code: string): string {
  let out = '';
  let i = 0;
  const NEEDLE = 'validate(';
  while (i < code.length) {
    const at = code.indexOf(NEEDLE, i);
    if (at === -1) {
      out += code.slice(i);
      break;
    }
    // Guard against matching `assertValidate(` etc.: require a boundary before.
    const prev = at > 0 ? (code[at - 1] ?? '') : '';
    if (/[A-Za-z0-9_$.]/.test(prev)) {
      out += code.slice(i, at + NEEDLE.length);
      i = at + NEEDLE.length;
      continue;
    }
    out += code.slice(i, at);
    // Find the matching close paren for this validate( call.
    const argStart = at + NEEDLE.length;
    let depth = 1;
    let j = argStart;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
    }
    const inner = code.slice(argStart, j - 1); // between the outer parens
    const [ruleSrc, exprSrc] = splitTopLevelComma(inner);
    out += inlineCheck(ruleSrc.trim(), exprSrc.trim());
    i = j;
  }
  return out;
}

// Split "tags.X(a,b), expr" into ["tags.X(a,b)", "expr"] on the top-level comma.
function splitTopLevelComma(s: string): [string, string] {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return [s.slice(0, k), s.slice(k + 1)];
  }
  return [s, ''];
}

function inlineCheck(ruleSrc: string, expr: string): string {
  const m = /^tags\.(\w+)\((.*)\)$/s.exec(ruleSrc);
  if (!m) return `validate(${ruleSrc}, ${expr})`; // leave untouched if unrecognized
  // A successful match of a 2-group regex has both groups; `?? ''` states that
  // without a non-null assertion (an unmatched group would leave the rule
  // untouched below, never crash).
  const kind = m[1] ?? '';
  const args = (m[2] ?? '').trim();
  switch (kind) {
    case 'Minimum':
      return `(typeof ${expr} === "number" && ${expr} >= ${args})`;
    case 'Maximum':
      return `(typeof ${expr} === "number" && ${expr} <= ${args})`;
    case 'MinLength':
      return `(typeof ${expr} === "string" && ${expr}.length >= ${args})`;
    case 'MaxLength':
      return `(typeof ${expr} === "string" && ${expr}.length <= ${args})`;
    case 'Pattern': {
      const re = args.replace(/^["'`]|["'`]$/g, '');
      return `(typeof ${expr} === "string" && /${re}/.test(${expr}))`;
    }
    case 'Enum': {
      const values = splitArgs(args);
      return `(${values.map(v => `${expr} === ${v}`).join(' || ')})`;
    }
    default:
      return `validate(${ruleSrc}, ${expr})`;
  }
}

function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
