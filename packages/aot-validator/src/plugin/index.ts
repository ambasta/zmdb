// AOT build plugin — implementation (#80: type-driven codegen).
// transformTypeChecks parses `is<T>(expr)` / `assert<T>(expr)` where T is an
// inline object/primitive type literal, and emits monomorphic, allocation-free,
// early-exit inline JS — NO TypeDescriptor walk. (The full TS-program plugin
// packaging is #81; this string harness pins & implements the emitted-JS
// contract the spec froze.)


// A parsed TS type: primitives or a flat/nested object type literal.
type PType =
  | { kind: 'number' | 'string' | 'boolean' }
  | { kind: 'object'; fields: { name: string; type: PType }[] };

// Minimal parser for the subset of TS type syntax the moltar model uses:
// primitives and `{ a: T; b: U }` object literals (nesting supported).
function parseType(src: string): PType {
  let i = 0;
  const s = src.trim();
  function ws() { while (i < s.length && /\s/.test(s[i]!)) i++; }
  function parse(): PType {
    ws();
    if (s[i] === '{') {
      i++; // consume {
      const fields: { name: string; type: PType }[] = [];
      ws();
      while (i < s.length && s[i] !== '}') {
        ws();
        // field name
        let name = '';
        while (i < s.length && /[A-Za-z0-9_$]/.test(s[i]!)) name += s[i++]!;
        ws();
        if (s[i] === ':') i++; // consume :
        // field type: recurse (handles nested {}), stop at ; or , or } at depth 0
        ws();
        let type: PType;
        if (s[i] === '{') {
          type = parse();
        } else {
          let prim = '';
          while (i < s.length && /[A-Za-z]/.test(s[i]!)) prim += s[i++]!;
          type = { kind: prim as 'number' | 'string' | 'boolean' };
        }
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
    while (i < s.length && /[A-Za-z]/.test(s[i]!)) prim += s[i++]!;
    return { kind: prim as 'number' | 'string' | 'boolean' };
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

// Find `fn<TYPE>(EXPR)` calls for fn in {is, assert} and rewrite them.
function rewriteCall(code: string, fn: 'is' | 'assert'): string {
  let out = '';
  let i = 0;
  const needle = `${fn}<`;
  while (i < code.length) {
    const at = code.indexOf(needle, i);
    if (at === -1) { out += code.slice(i); break; }
    // boundary check (avoid matching `xis<`)
    const prev = at > 0 ? code[at - 1]! : '';
    if (/[A-Za-z0-9_$.]/.test(prev)) { out += code.slice(i, at + needle.length); i = at + needle.length; continue; }
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
    const check = `(${emitCheck(t, expr)})`;
    out += fn === 'is'
      ? check
      : `((() => { if (!${check}) throw new Error("assertion failed"); return ${expr}; })())`;
    i = j;
  }
  return out;
}

export function transformTypeChecks(code: string): string {
  return rewriteCall(rewriteCall(code, 'is'), 'assert');
}

// unplugin-compatible plugin factory. The `transform` hook inlines
// is<T>()/assert<T>() calls in source modules via transformTypeChecks. Shape is
// what unplugin/vite/esbuild/rollup expect: { name, transform(code, id) }.
// For ts-patch/ttypescript, use the program transformer (createTransformer, #81
// follow-up) via tsconfig "plugins"; this hook covers the bundler path.
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
      const out = transformTypeChecks(code);
      return out === code ? null : { code: out };
    },
  };
}
