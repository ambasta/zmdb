import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';

import { validatePatternComplexity } from './regex-complexity.ts';

// Unified Single-Pass AOT Transformer Engine using TypeScript Token Scanner
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
    while (i < s.length && /\s/.test(s[i] ?? '')) i++;
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
        while (i < s.length && /[A-Za-z0-9_$]/.test(s[i] ?? '')) {
          name += s[i] ?? '';
          i++;
        }
        ws();
        if (s[i] === ':') i++; // consume :
        ws();
        let type: PType | undefined;
        if (s[i] === '{') {
          type = parse();
        } else {
          let prim = '';
          while (i < s.length && /[A-Za-z]/.test(s[i] ?? '')) {
            prim += s[i] ?? '';
            i++;
          }
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
    while (i < s.length && /[A-Za-z]/.test(s[i] ?? '')) {
      prim += s[i] ?? '';
      i++;
    }
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

function splitTopLevelComma(s: string): [string, string] {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k] ?? '';
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

function inlineCheck(ruleSrc: string, expr: string, ensureRegexCache?: () => void): string {
  const m = /^tags\.(\w+)\((.*)\)$/s.exec(ruleSrc);
  if (!m) return `validate(${ruleSrc}, ${expr})`;
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
      let raw = args.trim();
      const first = raw[0] ?? '';
      const last = raw.length > 0 ? (raw[raw.length - 1] ?? '') : '';
      const isQuoted =
        raw.length >= 2 &&
        ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`'));

      if (!isQuoted || (first === '`' && raw.includes('${'))) {
        if (ensureRegexCache) {
          ensureRegexCache();
          return `(typeof ${expr} === "string" && _getRegExp(${raw}).test(${expr}))`;
        }
        return `(typeof ${expr} === "string" && new RegExp(${raw}).test(${expr}))`;
      }

      raw = raw.slice(1, -1);
      const re = escapePattern(raw);
      validatePatternComplexity(re);
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

type MatchKind = 'validate' | 'is' | 'assert' | 'equals' | 'assertEquals';

const MATCH_KINDS: Record<string, MatchKind> = {
  validate: 'validate',
  is: 'is',
  assert: 'assert',
  equals: 'equals',
  assertEquals: 'assertEquals',
};

function getMatchKind(text: string): MatchKind | undefined {
  return MATCH_KINDS[text];
}

/**
 * Single-pass AST scanner-based transformation engine.
 * Scans code ONCE for all supported validation tags and generic type assertions.
 * Ignores calls inside comments, string literals, and correctly balances nested generic type arguments.
 */
export function transformCode(code: string): string {
  const scanner = createScanner(false, LanguageVariant.Standard);
  scanner.setText(code);

  let out = '';
  let lastPos = 0;

  const hoisted: string[] = [];
  let hasRegexCache = false;

  const ensureRegexCache = () => {
    if (!hasRegexCache) {
      hasRegexCache = true;
      hoisted.push(
        'const _regexCache = new Map();\nfunction _getRegExp(p) { let re = _regexCache.get(p); if (!re) { re = new RegExp(p); _regexCache.set(p, re); } return re; }',
      );
    }
  };

  let token = scanner.scan();
  while (token !== SyntaxKind.EndOfFile) {
    const tokenStart = scanner.getTokenStart();
    const tokenEnd = scanner.getTokenEnd();

    if (tokenStart < lastPos) {
      token = scanner.scan();
      continue;
    }

    const text = scanner.getTokenText();
    const kind = getMatchKind(text);

    if (kind !== undefined) {
      const prevChar = tokenStart > 0 ? (code[tokenStart - 1] ?? '') : '';
      if (prevChar && /[A-Za-z0-9_$.]/.test(prevChar)) {
        token = scanner.scan();
        continue;
      }

      let i = tokenEnd;
      while (i < code.length && /\s/.test(code[i] ?? '')) i++;

      let typeSrc = '';
      if (i < code.length && code[i] === '<') {
        let depth = 1;
        const typeStart = i + 1;
        i++;
        while (i < code.length && depth > 0) {
          if (code[i] === '<') depth++;
          else if (code[i] === '>') depth--;
          i++;
        }
        if (depth === 0) {
          typeSrc = code.slice(typeStart, i - 1);
        }
      }

      while (i < code.length && /\s/.test(code[i] ?? '')) i++;

      if (i < code.length && code[i] === '(') {
        let depth = 1;
        const argStart = i + 1;
        i++;
        while (i < code.length && depth > 0) {
          if (code[i] === '(') depth++;
          else if (code[i] === ')') depth--;
          i++;
        }
        if (depth === 0) {
          const argSrc = code.slice(argStart, i - 1);
          // boundary: kind is safely narrowed from MatchKind | undefined via getMatchKind(text) lookup above
          if (kind === undefined) {
            token = scanner.scan();
            continue;
          }

          let replacement: string | null = null;
          if (kind === 'validate' && !typeSrc) {
            const [ruleSrc, exprSrc] = splitTopLevelComma(argSrc);
            if (ruleSrc && exprSrc) {
              replacement = inlineCheck(ruleSrc.trim(), exprSrc.trim(), ensureRegexCache);
            }
          } else if (typeSrc) {
            const t = parseType(typeSrc);
            if (t) {
              const expr = argSrc.trim();
              const check = `(${emitCheck(t, expr)})`;
              if (kind === 'is') {
                replacement = check;
              } else if (kind === 'equals') {
                replacement = `(${emitEqualsCheck(t, expr)})`;
              } else if (kind === 'assert') {
                replacement = `((() => { if (!${check}) throw new Error("assertion failed"); return ${expr}; })())`;
              } else if (kind === 'assertEquals') {
                const eq = emitEqualsCheck(t, expr);
                replacement = `((() => { if (!(${eq})) throw new Error("assertion failed"); return ${expr}; })())`;
              } else if (kind === 'validate') {
                replacement = `((${check}) ? { success: true, data: ${expr} } : { success: false, errors: [{ path: "input", expected: "valid type", value: ${expr}, message: "validation failed" }] })`;
              }
            }
          }

          if (replacement !== null) {
            out += code.slice(lastPos, tokenStart);
            out += replacement;
            lastPos = i;
          }
        }
      }
    }

    token = scanner.scan();
  }

  out += code.slice(lastPos);
  if (hoisted.length > 0) {
    return hoisted.join('\n') + '\n' + out;
  }
  return out;
}
