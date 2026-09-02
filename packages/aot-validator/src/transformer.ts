// The front door: source text in, source text out.
//
// Two paths, and the split is the whole point of Phase 5.
//
// `transformFile` is the real one. It asks the compiler what `T` is, reflects the answer
// into IR, and hands the IR to the emitter. Every type TypeScript can express is
// therefore either understood exactly or refused by name (REQ-TF-8).
//
// `transformCode` is what is left of the old text-based transformer: `validate(tags.X,
// …)` inlining, which needs no types because the rule is spelled out at the call site.
// It used to *also* parse type arguments with a 60-line hand-rolled parser, and that is
// deleted rather than kept as a fallback. `f70186c6` is the reason: the parser read
// `string[]` as `string` and `number | string` as `number`, so a call was inlined to a
// check that answers a different question, and a wrong answer that looks right is worse
// than no answer at all. A call site the checker cannot reach is now left alone.
//
// Rewriting is by text offset rather than by AST printing, because `sourceFile.text` is
// byte-identical to the file on disk (measured) and every other byte of the file — the
// comments, the formatting, the sourcemap-relevant line breaks — should survive
// untouched. The price is that the offsets are only valid for the exact text the
// compiler parsed, so `transformFile` checks that before it trusts one.

import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';

import { Emitter, escapePattern, type EmitOptions } from './emit/index.ts';
import { findCallSites, type CallSite } from './reflect/callsites.ts';
import { Reflector, type ReflectOptions } from './reflect/index.ts';
import type { ReflectSession } from './reflect/session.ts';
import { MAX_REGEX_CACHE_SIZE, validatePatternComplexity } from './regex-complexity.ts';

/** The calls `transformFile` rewrites. Matched by identifier text — see `callsites.ts`. */
const CALLEES: ReadonlySet<string> = new Set(['is', 'assert', 'equals', 'assertEquals', 'validate', 'random']);

/** A call site left alone, and why. Plan D4: the build reports these as errors. */
export interface TransformDiagnostic {
  readonly fileName: string;
  /** Offset of the call this came from, when it came from one. */
  readonly position?: number;
  readonly callee?: string;
  /** The property chain within the type that reached the refusal. */
  readonly path: string;
  readonly reason: string;
  /** The type as the checker prints it, when that is more use than the path. */
  readonly source?: string;
}

export interface TransformResult {
  readonly code: string;
  readonly changed: boolean;
  readonly diagnostics: readonly TransformDiagnostic[];
}

export interface TransformContext {
  /** One session per build, held open by the caller. See `session.ts`. */
  readonly session: ReflectSession;
  readonly emit?: EmitOptions;
  readonly reflect?: ReflectOptions;
}

/**
 * Rewrite every reachable validation call in one file.
 *
 * The file must be part of the session's project and its text must be what the compiler
 * parsed. When either does not hold the offsets are meaningless, so this degrades to
 * `transformCode` and says so, rather than rewriting at a position it guessed.
 */
export function transformFile(fileName: string, code: string, context: TransformContext): TransformResult {
  const { session } = context;

  const sourceFile = session.sourceFile(fileName);
  if (!sourceFile) {
    return degrade(fileName, code, 'this file is not part of the TypeScript project the session loaded');
  }
  if (sourceFile.text !== code) {
    // Another plugin got here first, or the watcher is a revision behind. Either way the
    // AST describes text we do not have, and an offset into the wrong string lands in
    // the middle of an identifier.
    return degrade(
      fileName,
      code,
      'the text handed to the transformer is not the text the compiler parsed, so every offset in it would be a guess',
    );
  }

  const sites = findCallSites(sourceFile, CALLEES);
  if (sites.length === 0) {
    const out = transformCode(code);
    return { code: out, changed: out !== code, diagnostics: [] };
  }

  const emitter = new Emitter(context.emit);
  // One reflector for the file, so two `is<User>(…)` calls agree on `User`'s name and
  // the emitter can then share one hoisted helper between them.
  const reflector = new Reflector(session.checker, sourceFile, context.reflect);
  const diagnostics: TransformDiagnostic[] = [];
  const rewriter = new Rewriter(code);
  let rewritten = 0;

  // Back to front. `findCallSites` walks pre-order, so reversing puts the innermost and
  // last call first, which is what keeps the offsets of everything before it valid.
  for (const site of sites.toReversed()) {
    const position = site.node.getStart();
    const reflectedAt = reflector.diagnostics.length;
    const emittedAt = emitter.diagnostics.length;

    const type = session.checker.getTypeFromTypeNode(site.typeArgument);
    if (!type) {
      // The checker has no type for a node it parsed, which in practice means the file
      // has an error in it. Rewriting from a type the compiler could not resolve is the
      // one thing this path exists to avoid.
      diagnostics.push({
        fileName,
        position,
        callee: site.callee,
        path: '',
        reason: 'the compiler could not resolve this type argument; the file probably does not compile',
      });
      continue;
    }
    const node = reflector.typeIR(type);

    const refusals = reflector.diagnostics.slice(reflectedAt);
    if (refusals.length > 0) {
      // The type is only partly understood, so nothing is emitted from it. This is the
      // f70186c6 rule applied to the checker-driven path: partial knowledge produces a
      // named build error, never a partial check.
      for (const refusal of refusals) diagnostics.push({ fileName, position, callee: site.callee, ...refusal });
      continue;
    }

    const replacement = emitFor(emitter, site, node, rewriter);
    if (replacement === undefined) {
      const emitted = emitter.diagnostics.slice(emittedAt);
      if (emitted.length === 0) {
        diagnostics.push({
          fileName,
          position,
          callee: site.callee,
          path: '',
          reason: `\`${site.callee}<T>()\` needs a value to check`,
        });
      }
      for (const refusal of emitted) diagnostics.push({ fileName, position, callee: site.callee, ...refusal });
      continue;
    }

    rewriter.replace(position, site.node.end, replacement);
    rewritten += 1;
  }

  let out = transformCode(rewriter.text);
  // No prelude when nothing was rewritten. A refused site can still have hoisted a helper
  // on its way to the refusal — `random<T>` reserves its integer sampler before it
  // discovers the `pattern` it cannot invert — and emitting that alone would leave dead
  // code in a file the transformer decided not to touch.
  if (rewritten > 0 && emitter.hasPrelude) out = withPrelude(out, emitter.prelude());
  return { code: out, changed: out !== code, diagnostics };
}

function degrade(fileName: string, code: string, reason: string): TransformResult {
  const out = transformCode(code);
  return { code: out, changed: out !== code, diagnostics: [{ fileName, path: '', reason }] };
}

function emitFor(emitter: Emitter, site: CallSite, node: Parameters<Emitter['emitIs']>[0], rewriter: Rewriter) {
  if (site.callee === 'random') return emitter.emitRandom(node);

  const argument = site.node.arguments[0];
  if (!argument) return undefined;
  // Read through the rewriter, not the original text: in `assert<A>(is<B>(x))` the inner
  // call has already been replaced, and taking the original text here would carry a live
  // `is<B>(x)` into the output and silently undo it.
  const expression = rewriter.slice(argument.getStart(), argument.end);

  switch (site.callee) {
    case 'is':
      return emitter.emitIs(node, expression);
    case 'equals':
      return emitter.emitEquals(node, expression);
    case 'assert':
      return emitter.emitAssert(node, expression, false);
    case 'assertEquals':
      return emitter.emitAssert(node, expression, true);
    case 'validate':
      return emitter.emitValidate(node, expression);
    default:
      return undefined;
  }
}

/** Hoisted helpers go at the top of the module, but after a shebang if there is one. */
function withPrelude(code: string, prelude: string): string {
  if (!code.startsWith('#!')) return `${prelude}\n${code}`;
  const newline = code.indexOf('\n');
  if (newline === -1) return `${code}\n${prelude}\n`;
  return `${code.slice(0, newline + 1)}${prelude}\n${code.slice(newline + 1)}`;
}

/**
 * Text edits in original coordinates, applied back to front, with one twist: `slice`
 * reads the *current* text, so an outer call sees an inner one already rewritten.
 *
 * The bookkeeping is a list of applied edits and their length deltas. Because AST spans
 * nest and never partially overlap, and because callers work backwards, every applied
 * edit is either inside the span being asked about or entirely after it — which is what
 * makes a single sum the right answer.
 */
class Rewriter {
  #text: string;
  /** Applied edits in original coordinates. Nested ones are folded into their parent. */
  #edits: { start: number; end: number; delta: number }[] = [];

  constructor(text: string) {
    this.#text = text;
  }

  get text(): string {
    return this.#text;
  }

  /** A span of the original text, as it reads now. */
  slice(start: number, end: number): string {
    return this.#text.slice(start, this.#current(start, end));
  }

  /** Replace a span of the original text. Call in descending order of `start`. */
  replace(start: number, end: number, text: string): void {
    const current = this.#current(start, end);
    this.#text = this.#text.slice(0, start) + text + this.#text.slice(current);
    // `text` was built from the current buffer, so it already contains every nested
    // edit. They stop being separate deltas and become part of this one; leaving them
    // in the list would count their lengths twice.
    this.#edits = this.#edits.filter(edit => edit.start < start || edit.end > end);
    this.#edits.push({ start, end, delta: text.length - (end - start) });
  }

  #current(start: number, end: number): number {
    let shift = 0;
    for (const edit of this.#edits) {
      if (edit.start >= start && edit.end <= end) shift += edit.delta;
    }
    return end + shift;
  }
}

// ---------------------------------------------------------------------------
// The no-checker path: `validate(tags.X, expr)`
// ---------------------------------------------------------------------------

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

function inlineCheck(ruleSrc: string, expr: string, ensureRegexCache?: () => void): string {
  const m = /^tags\.(\w+)\((.*)\)$/s.exec(ruleSrc);
  if (!m) return `validate(${ruleSrc}, ${expr})`;
  const kind = m[1] ?? '';
  const args = (m[2] ?? '').trim();
  switch (kind) {
    case 'Min':
      return `(typeof ${expr} === "number" && ${expr} >= ${args})`;
    case 'Max':
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

/**
 * Inline `validate(tags.X(…), expr)`, and nothing else.
 *
 * A rule spelled at the call site needs no type information, which is why this survives
 * without a compiler: the scanner is here only to avoid rewriting the inside of a string
 * literal or a comment. `validate<T>(expr)` and every other type-argument form are left
 * for `transformFile`; this function does not look at type arguments at all beyond
 * skipping past them.
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
        `const _MAX_REGEX_CACHE_SIZE = ${MAX_REGEX_CACHE_SIZE};\nconst _regexCache = new Map();\nfunction _getRegExp(p) { let re = _regexCache.get(p); if (re) { _regexCache.delete(p); _regexCache.set(p, re); return re; } if (_regexCache.size >= _MAX_REGEX_CACHE_SIZE) { const k = _regexCache.keys().next().value; if (k !== undefined) _regexCache.delete(k); } re = new RegExp(p); _regexCache.set(p, re); return re; }`,
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

    if (scanner.getTokenText() === 'validate') {
      const prevChar = tokenStart > 0 ? (code[tokenStart - 1] ?? '') : '';
      if (prevChar && /[A-Za-z0-9_$.]/.test(prevChar)) {
        token = scanner.scan();
        continue;
      }

      let i = tokenEnd;
      while (i < code.length && /\s/.test(code[i] ?? '')) i++;

      // A type argument means this is `validate<T>(…)`, which belongs to the checker.
      let typed = false;
      if (i < code.length && code[i] === '<') {
        let depth = 1;
        i++;
        while (i < code.length && depth > 0) {
          if (code[i] === '<') depth++;
          else if (code[i] === '>') depth--;
          i++;
        }
        typed = depth === 0;
      }

      while (i < code.length && /\s/.test(code[i] ?? '')) i++;

      if (!typed && i < code.length && code[i] === '(') {
        let depth = 1;
        const argStart = i + 1;
        i++;
        while (i < code.length && depth > 0) {
          if (code[i] === '(') depth++;
          else if (code[i] === ')') depth--;
          i++;
        }
        if (depth === 0) {
          const [ruleSrc, exprSrc] = splitTopLevelComma(code.slice(argStart, i - 1));
          if (ruleSrc && exprSrc) {
            out += code.slice(lastPos, tokenStart);
            out += inlineCheck(ruleSrc.trim(), exprSrc.trim(), ensureRegexCache);
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
