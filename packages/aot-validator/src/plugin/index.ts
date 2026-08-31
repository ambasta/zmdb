// AOT build plugin — implementation (#80: type-driven codegen).
// transformTypeChecks parses `is<T>(expr)` / `assert<T>(expr)` where T is an
// inline object/primitive type literal, and emits monomorphic, allocation-free,
// early-exit inline JS — NO TypeDescriptor walk. (The full TS-program plugin
// packaging is #81; this string harness pins & implements the emitted-JS
// contract the spec froze.)

import { transformSource } from '../index.ts';
// A parsed TS type: primitives or a flat/nested object type literal.
type PType = { kind: 'number' | 'string' | 'boolean' } | { kind: 'object'; fields: { name: string; type: PType }[] };

// Minimal parser for the subset of TS type syntax the moltar model uses:
// primitives and `{ a: T; b: U }` object literals (nesting supported).
// `undefined` = "not in the supported subset". Callers must then leave the call
// site untouched: emitting a check for a type we did not understand would be a
// silently-wrong validator, which PRD P4 rules out. (Previously an unknown
// primitive was cast to a `kind` the emitter has no case for, and the emission
// became the literal string `undefined` — always falsy. That is the bug this
// return type removes.) Widening the subset is #81's job, not this parser's.
function primType(prim: string): PType | undefined {
  return prim === 'number' || prim === 'string' || prim === 'boolean' ? { kind: prim } : undefined;
}

function parseType(src: string): PType | undefined {
  let i = 0;
  const s = src.trim();
  // Cursor read as a string: every call site is already bounded by `i < s.length`,
  // and `''` fails every character class below, so the empty default terminates
  // the same loops that the bound does — no `s[i]!` needed.
  const at = (k: number): string => s[k] ?? '';
  function ws() {
    while (i < s.length && /\s/.test(at(i))) i++;
  }
  function parse(): PType | undefined {
    ws();
    if (s[i] === '{') {
      i++; // consume {
      const fields: { name: string; type: PType }[] = [];
      ws();
      while (i < s.length && s[i] !== '}') {
        ws();
        // field name
        let name = '';
        while (i < s.length && /[A-Za-z0-9_$]/.test(at(i))) name += at(i++);
        ws();
        if (s[i] === ':') i++; // consume :
        // field type: recurse (handles nested {}), stop at ; or , or } at depth 0
        ws();
        let type: PType | undefined;
        if (s[i] === '{') {
          type = parse();
        } else {
          let prim = '';
          while (i < s.length && /[A-Za-z]/.test(at(i))) prim += at(i++);
          type = primType(prim);
        }
        if (!type) return undefined; // unsupported field type ⇒ unsupported object
        fields.push({ name, type });
        ws();
        if (s[i] === ';' || s[i] === ',') i++;
        ws();
      }
      if (s[i] === '}') i++; // consume }
      return { kind: 'object', fields };
    }
    // primitive
    let prim = '';
    while (i < s.length && /[A-Za-z]/.test(at(i))) prim += at(i++);
    return primType(prim);
  }
  return parse();
}

// Emit an inline boolean expression checking that `expr` matches `t`.
function emitCheck(t: PType, expr: string): string {
  switch (t.kind) {
    case 'number':
      return `typeof ${expr} === "number"`;
    case 'string':
      return `typeof ${expr} === "string"`;
    case 'boolean':
      return `typeof ${expr} === "boolean"`;
    case 'object': {
      const parts = [`typeof ${expr} === "object"`, `${expr} !== null`];
      for (const f of t.fields) parts.push(emitCheck(f.type, `${expr}.${f.name}`));
      return parts.join(' && ');
    }
  }
}

function emitExcessKeyGuards(t: PType, expr: string, varPrefix = '_c'): string[] {
  if (t.kind !== 'object') return [];
  const guards: string[] = [];
  const topCount = t.fields.length;
  guards.push(
    `let ${varPrefix} = 0; for (const _ in ${expr}) { if (++${varPrefix} > ${topCount}) return false; } if (${varPrefix} !== ${topCount}) return false;`,
  );
  let idx = 0;
  for (const f of t.fields) {
    if (f.type.kind === 'object') {
      guards.push(...emitExcessKeyGuards(f.type, `${expr}.${f.name}`, `${varPrefix}_${idx++}`));
    }
  }
  return guards;
}

function emitEqualsCheck(t: PType, expr: string): string {
  if (t.kind !== 'object') {
    return emitCheck(t, expr);
  }
  const check = emitCheck(t, expr);
  const excessGuards = emitExcessKeyGuards(t, expr).join(' ');
  return `((() => { if (!(${check})) return false; ${excessGuards} return true; })())`;
}

type SupportedFn = 'is' | 'assert' | 'validate' | 'equals' | 'assertEquals';

// Find `fn<TYPE>(EXPR)` calls for supported functions and rewrite them.
function rewriteCall(code: string, fn: SupportedFn): string {
  let out = '';
  let i = 0;
  const needle = `${fn}<`;
  while (i < code.length) {
    const at = code.indexOf(needle, i);
    if (at === -1) {
      out += code.slice(i);
      break;
    }
    // boundary check (avoid matching `xis<`)
    const prev = at > 0 ? (code[at - 1] ?? '') : '';
    if (/[A-Za-z0-9_$.]/.test(prev)) {
      out += code.slice(i, at + needle.length);
      i = at + needle.length;
      continue;
    }
    out += code.slice(i, at);
    // parse the <...> type argument (balanced angle brackets)
    let j = at + needle.length;
    let depth = 1;
    const typeStart = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '<') depth++;
      else if (code[j] === '>') depth--;
    }
    const typeSrc = code.slice(typeStart, j - 1);
    // now expect ( EXPR )
    while (j < code.length && code[j] !== '(') j++;
    const exprStart = ++j;
    let pdepth = 1;
    for (; j < code.length && pdepth > 0; j++) {
      if (code[j] === '(') pdepth++;
      else if (code[j] === ')') pdepth--;
    }
    const expr = code.slice(exprStart, j - 1).trim();
    const t = parseType(typeSrc);
    if (!t) {
      // Outside the supported subset (e.g. a named interface). Copy the call
      // through verbatim so it keeps its runtime-descriptor semantics; the build
      // succeeds and nothing wrong is emitted.
      out += code.slice(at, j);
      i = j;
      continue;
    }
    const check = `(${emitCheck(t, expr)})`;
    const equalsCheck = emitEqualsCheck(t, expr);

    switch (fn) {
      case 'is':
        out += check;
        break;
      case 'assert':
        out += `((() => { if (!${check}) throw new Error("assertion failed"); return ${expr}; })())`;
        break;
      case 'validate':
        out += `((() => { const _ok = ${check}; return _ok ? { success: true, data: ${expr} } : { success: false, errors: [{ path: "input", expected: "${typeSrc.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", value: ${expr}, message: "validation failed" }] }; })())`;
        break;
      case 'equals':
        out += `(${equalsCheck})`;
        break;
      case 'assertEquals':
        out += `((() => { if (!(${equalsCheck})) throw new Error("assertion failed"); return ${expr}; })())`;
        break;
    }
    i = j;
  }
  return out;
}

export function transformTypeChecks(code: string): string {
  let out = code;
  for (const fn of ['is', 'assert', 'validate', 'equals', 'assertEquals'] as const) {
    out = rewriteCall(out, fn);
  }
  return out;
}

// unplugin-compatible plugin factory. The `transform` hook inlines
// validator calls in source modules. Shape is what unplugin/vite/esbuild/rollup expect:
// { name, transform(code, id) }.
export interface UnpluginLike {
  readonly name: string;
  transform(code: string, id: string): { code: string } | null;
}

export function zmdbAot(): UnpluginLike {
  return {
    name: 'zmdb-aot',
    transform(code: string, id: string): { code: string } | null {
      // Only source modules; never touch dependencies or declaration files.
      if (id.includes('node_modules')) return null;
      if (!/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(id)) return null;
      let out = transformTypeChecks(code);
      out = transformSource(out);
      return out === code ? null : { code: out };
    },
  };
}
