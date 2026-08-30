// Unified Single-Pass AOT Transformer Engine
// Scans TS/JS source code ONCE for all supported validation call expressions:
// validate(tags.X, expr), is<T>(expr), assert<T>(expr), equals<T>(expr), assertEquals<T>(expr).

type PType = { kind: 'number' | 'string' | 'boolean' } | { kind: 'object'; fields: { name: string; type: PType }[] };

function primType(prim: string): PType | undefined {
  return prim === 'number' || prim === 'string' || prim === 'boolean' ? { kind: prim } : undefined;
}

// Minimal parser for TS type syntax: primitives and `{ a: T; b: U }` object literals.
function parseType(src: string): PType | undefined {
  let i = 0;
  const s = src.trim();
  function ws() {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  }
  function parse(): PType | undefined {
    ws();
    if (s[i] === '{') {
      i++; // consume {
      const fields: { name: string; type: PType }[] = [];
      ws();
      while (i < s.length && s[i] !== '}') {
        ws();
        let name = '';
        while (i < s.length && /[A-Za-z0-9_$]/.test(s[i]!)) name += s[i++]!;
        ws();
        if (s[i] === ':') i++; // consume :
        ws();
        let type: PType | undefined;
        if (s[i] === '{') {
          type = parse();
        } else {
          let prim = '';
          while (i < s.length && /[A-Za-z]/.test(s[i]!)) prim += s[i++]!;
          type = primType(prim);
        }
        if (!type) return undefined;
        fields.push({ name, type });
        ws();
        if (s[i] === ';' || s[i] === ',') i++;
        ws();
      }
      if (s[i] === '}') i++; // consume }
      return { kind: 'object', fields };
    }
    let prim = '';
    while (i < s.length && /[A-Za-z]/.test(s[i]!)) prim += s[i++]!;
    return primType(prim);
  }
  return parse();
}

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

// Dedicated escaping helper to sanitize pattern inputs before embedding into compiled regex literals.
export function escapePattern(pattern: string): string {
  return pattern
    .replace(/(?<!\\)(?:\\\\)*\//g, match => match.slice(0, -1) + '\\/')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function inlineCheck(ruleSrc: string, expr: string): string {
  const m = /^tags\.(\w+)\((.*)\)$/s.exec(ruleSrc);
  if (!m) return `validate(${ruleSrc}, ${expr})`;
  const kind = m[1]!;
  const args = m[2]!.trim();
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
      let raw = args.trim();
      const first = raw[0];
      const last = raw[raw.length - 1];
      const isQuoted =
        raw.length >= 2 &&
        ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`'));

      if (!isQuoted) {
        return `validate(${ruleSrc}, ${expr})`;
      }

      if (first === '`' && raw.includes('${')) {
        return `validate(${ruleSrc}, ${expr})`;
      }

      raw = raw.slice(1, -1);
      const re = escapePattern(raw);
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

/**
 * Single-pass transformation engine.
 * Scans code ONCE for all supported validation tags and generic type assertions.
 */
export function transformCode(code: string): string {
  let out = '';
  let i = 0;

  type MatchKind = 'validate' | 'is' | 'assert' | 'equals' | 'assertEquals';

  const candidates: { kind: MatchKind; needle: string }[] = [
    { kind: 'assertEquals', needle: 'assertEquals<' },
    { kind: 'assert', needle: 'assert<' },
    { kind: 'equals', needle: 'equals<' },
    { kind: 'is', needle: 'is<' },
    { kind: 'validate', needle: 'validate(' },
    { kind: 'validate', needle: 'validate<' },
  ];

  while (i < code.length) {
    let bestAt = -1;
    let bestKind: MatchKind = 'validate';
    let bestNeedleLen = 0;

    for (const cand of candidates) {
      const at = code.indexOf(cand.needle, i);
      if (at !== -1) {
        if (bestAt === -1 || at < bestAt || (at === bestAt && cand.needle.length > bestNeedleLen)) {
          bestAt = at;
          bestKind = cand.kind;
          bestNeedleLen = cand.needle.length;
        }
      }
    }

    if (bestAt === -1) {
      out += code.slice(i);
      break;
    }

    // Boundary check: ensure match is not part of a larger identifier
    const prev = bestAt > 0 ? code[bestAt - 1]! : '';
    if (/[A-Za-z0-9_$.]/.test(prev)) {
      out += code.slice(i, bestAt + bestNeedleLen);
      i = bestAt + bestNeedleLen;
      continue;
    }

    out += code.slice(i, bestAt);

    if (bestKind === 'validate' && code.slice(bestAt, bestAt + 9) === 'validate(') {
      // Non-generic validate(ruleSrc, exprSrc)
      const argStart = bestAt + 9;
      let depth = 1;
      let j = argStart;
      for (; j < code.length && depth > 0; j++) {
        if (code[j] === '(') depth++;
        else if (code[j] === ')') depth--;
      }
      const inner = code.slice(argStart, j - 1);
      const [ruleSrc, exprSrc] = splitTopLevelComma(inner);
      out += inlineCheck(ruleSrc.trim(), exprSrc.trim());
      i = j;
    } else {
      // Generic call: is<T>(expr), assert<T>(expr), equals<T>(expr), assertEquals<T>(expr), validate<T>(expr)
      let j = bestAt + bestNeedleLen;
      let depth = 1;
      const typeStart = j;
      for (; j < code.length && depth > 0; j++) {
        if (code[j] === '<') depth++;
        else if (code[j] === '>') depth--;
      }
      const typeSrc = code.slice(typeStart, j - 1);

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
        out += code.slice(bestAt, j);
        i = j;
        continue;
      }
      const check = `(${emitCheck(t, expr)})`;

      if (bestKind === 'is' || bestKind === 'equals') {
        out += check;
      } else if (bestKind === 'assert' || bestKind === 'assertEquals') {
        out += `((() => { if (!${check}) throw new Error("assertion failed"); return ${expr}; })())`;
      } else if (bestKind === 'validate') {
        out += `((${check}) ? { success: true, data: ${expr} } : { success: false, errors: [{ path: "input", expected: "valid type", value: ${expr}, message: "validation failed" }] })`;
      }
      i = j;
    }
  }

  return out;
}
