// Build-time syntax highlighting.
//
// Every code block on the docs site is tokenised here, at build time, into spans
// the stylesheet colours. Nothing is highlighted in the browser, so there is no
// highlighter to download, no flash of unstyled code, and the markup a reader
// copies is still exactly the source (the spans carry no text of their own).
//
// This is a lexer for the languages the docs actually use, not a parser. It gets
// comments, strings, template literals, numbers, keywords, types, decorators and
// call sites right; it will not colour a pathological expression perfectly. The
// failure mode is a token rendered as plain text, which is why the tokeniser is
// allowed to be this small.

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const TS_KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'new',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'type',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
]);

const TS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const TS_TYPES = new Set(['any', 'bigint', 'boolean', 'never', 'number', 'object', 'string', 'symbol', 'unknown']);

const SQL_KEYWORDS = new Set([
  'add',
  'all',
  'alter',
  'and',
  'as',
  'asc',
  'begin',
  'between',
  'by',
  'case',
  'cascade',
  'column',
  'commit',
  'constraint',
  'create',
  'cross',
  'default',
  'delete',
  'desc',
  'distinct',
  'drop',
  'else',
  'end',
  'exists',
  'foreign',
  'from',
  'full',
  'group',
  'having',
  'if',
  'in',
  'index',
  'inner',
  'insert',
  'into',
  'is',
  'join',
  'key',
  'left',
  'like',
  'limit',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'outer',
  'primary',
  'references',
  'returning',
  'right',
  'rollback',
  'select',
  'set',
  'table',
  'then',
  'transaction',
  'union',
  'unique',
  'update',
  'using',
  'values',
  'when',
  'where',
  'with',
]);

const SHELL_BUILTINS = new Set([
  'cd',
  'cp',
  'curl',
  'docker',
  'echo',
  'export',
  'git',
  'ls',
  'mkdir',
  'mv',
  'node',
  'npm',
  'npx',
  'podman',
  'psql',
  'rm',
  'sh',
  'sudo',
  'yarn',
]);

function span(kind, text) {
  return `<span class="tok-${kind}">${escapeHtml(text)}</span>`;
}

function lineEnd(code, from) {
  const end = code.indexOf('\n', from);
  return end === -1 ? code.length : end;
}

// A single left-to-right scan. Each branch consumes one whole token and appends
// it; the default branch consumes one character as plain text.
function tokenize(code, { keywords, literals, types, comment = 'slash', regex = false }) {
  let out = '';
  let i = 0;
  // Whether the previous token was a value, which is what decides between a regex
  // literal and division. It only needs to be roughly right.
  let afterValue = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] ?? '';

    const isLineComment =
      (comment === 'slash' && ch === '/' && next === '/') ||
      (comment === 'dash' && ch === '-' && next === '-') ||
      (comment === 'hash' && ch === '#');
    if (isLineComment) {
      const stop = lineEnd(code, i);
      out += span('comment', code.slice(i, stop));
      i = stop;
      afterValue = false;
      continue;
    }

    if (comment === 'slash' && ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += span('comment', code.slice(i, stop));
      i = stop;
      afterValue = false;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j += 1;
          break;
        }
        // An unterminated quote is far more likely to be an apostrophe in prose
        // than a string running to the end of the block, so a newline ends the
        // token for the quotes that cannot legally span lines.
        if (code[j] === '\n' && ch !== '`') break;
        j += 1;
      }
      out += span('string', code.slice(i, j));
      i = j;
      afterValue = true;
      continue;
    }

    if (regex && ch === '/' && !afterValue) {
      let j = i + 1;
      let closed = false;
      let inClass = false;
      while (j < code.length && code[j] !== '\n') {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        else if (code[j] === '/' && !inClass) {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j < code.length && /[a-z]/.test(code[j])) j += 1;
        out += span('regex', code.slice(i, j));
        i = j;
        afterValue = true;
        continue;
      }
    }

    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? '')) {
      let j = i;
      while (j < code.length && /[0-9a-fx_.n]/i.test(code[j])) j += 1;
      out += span('number', code.slice(i, j));
      i = j;
      afterValue = true;
      continue;
    }

    // Decorators are the one token starting with a non-word character, so they are
    // consumed here rather than by the identifier branch below: `@` is not a `\w`,
    // and that branch would consume nothing and spin.
    if (ch === '@' && /[A-Za-z_]/.test(next)) {
      let j = i + 1;
      while (j < code.length && /[\w$.]/.test(code[j])) j += 1;
      out += span('decorator', code.slice(i, j));
      i = j;
      afterValue = false;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j += 1;
      const word = code.slice(i, j);
      let kind = null;
      if (keywords.has(word) || keywords.has(word.toLowerCase())) kind = 'keyword';
      else if (literals?.has(word) === true) kind = 'literal';
      else if (types?.has(word) === true) kind = 'type';
      // A capitalised identifier in these docs is a type or a class often enough
      // that colouring it as one is more help than harm.
      else if (types !== undefined && /^[A-Z]/.test(word)) kind = 'type';
      else if (code[j] === '(') kind = 'fn';
      out += kind === null ? escapeHtml(word) : span(kind, word);
      i = j;
      afterValue = kind !== 'keyword';
      continue;
    }

    out += escapeHtml(ch);
    if (!/\s/.test(ch)) afterValue = ch === ')' || ch === ']';
    i += 1;
  }
  return out;
}

const LANGUAGES = {
  ts: code => tokenize(code, { keywords: TS_KEYWORDS, literals: TS_LITERALS, types: TS_TYPES, regex: true }),
  sql: code => tokenize(code, { keywords: SQL_KEYWORDS, comment: 'dash' }),
  bash: code => tokenize(code, { keywords: SHELL_BUILTINS, comment: 'hash' }),
  json: code => tokenize(code, { keywords: new Set(), literals: TS_LITERALS }),
  yml: code => tokenize(code, { keywords: new Set(), literals: TS_LITERALS, comment: 'hash' }),
};

const ALIASES = {
  javascript: 'ts',
  js: 'ts',
  jsonc: 'json',
  mjs: 'ts',
  sh: 'bash',
  shell: 'bash',
  tsx: 'ts',
  typescript: 'ts',
  yaml: 'yml',
  zsh: 'bash',
};

/**
 * Highlight one fenced code block. A language this file does not know is escaped
 * and returned unchanged — plain code, never mis-coloured code.
 */
export function highlight(code, lang) {
  const impl = LANGUAGES[ALIASES[lang] ?? lang];
  return impl === undefined ? escapeHtml(code) : impl(code);
}
