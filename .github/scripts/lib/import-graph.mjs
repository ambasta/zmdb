// Shared static import-graph walk for repository verification scripts.
//
// It follows relative JavaScript specifiers to their TypeScript siblings and
// workspace package exports across package boundaries. Callers choose ownership
// mode (all production imports, including type-only edges) or runtime mode
// (only edges that survive emit).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

const ESCAPES = {
  0: '\0',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

const isIdentifierStart = value => value !== undefined && /[A-Za-z_$]/.test(value);
const isIdentifierPart = value => value !== undefined && /[A-Za-z0-9_$]/.test(value);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  for (const condition of ['import', 'node', 'default', 'types']) {
    const target = value[condition];
    if (typeof target === 'string') return target;
  }
  return undefined;
}

function packageExportTarget(packageRecord, selector) {
  const exports = packageRecord.exports;
  if (typeof exports === 'string') return selector === '.' ? exports : undefined;
  if (!isRecord(exports)) return undefined;
  if (selector === '.' && !Object.keys(exports).some(key => key.startsWith('.'))) {
    return exportTarget(exports);
  }
  return exportTarget(exports[selector]);
}

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return undefined;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0] || undefined;
}

function workspacePackages(root, source) {
  if (source !== undefined) {
    const packageRecords = Array.isArray(source) ? source : source.packages;
    return new Map(
      packageRecords.map(packageRecord => [
        packageRecord.npmName,
        {
          dir: packageRecord.directoryPath,
          exports: packageRecord.manifest.exports ?? {},
        },
      ]),
    );
  }

  const packagesDir = join(root, 'packages');
  const packages = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const packageManifest = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof packageManifest.name === 'string') {
      packages.set(packageManifest.name, {
        dir,
        exports: packageManifest.exports ?? {},
      });
    }
  }
  return packages;
}

function readString(source, start) {
  const quote = source[start];
  let index = start + 1;
  let value = '';
  while (index < source.length) {
    const character = source[index];
    index += 1;
    if (character === quote) return { index, value };
    if (character !== '\\') {
      value += character;
      continue;
    }

    const escaped = source[index];
    index += 1;
    if (escaped === '\n') continue;
    if (escaped === '\r') {
      if (source[index] === '\n') index += 1;
      continue;
    }
    if (escaped === 'x') {
      const digits = source.slice(index, index + 2);
      if (/^[0-9A-Fa-f]{2}$/.test(digits)) {
        value += String.fromCodePoint(Number.parseInt(digits, 16));
        index += 2;
        continue;
      }
    }
    if (escaped === 'u') {
      if (source[index] === '{') {
        const end = source.indexOf('}', index + 1);
        const digits = end === -1 ? '' : source.slice(index + 1, end);
        if (/^[0-9A-Fa-f]+$/.test(digits)) {
          value += String.fromCodePoint(Number.parseInt(digits, 16));
          index = end + 1;
          continue;
        }
      } else {
        const digits = source.slice(index, index + 4);
        if (/^[0-9A-Fa-f]{4}$/.test(digits)) {
          value += String.fromCodePoint(Number.parseInt(digits, 16));
          index += 4;
          continue;
        }
      }
    }
    value += ESCAPES[escaped] ?? escaped ?? '';
  }
  return { index, value };
}

function canStartRegex(previous) {
  if (previous === undefined) return true;
  if (previous.kind === 'identifier') return REGEX_PREFIX_KEYWORDS.has(previous.value);
  if (previous.kind === 'string' || previous.kind === 'number') return false;
  return ![')', '.', ']', '}'].includes(previous.value);
}

function skipRegex(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    index += 1;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
      continue;
    }
    if (character === ']') {
      inCharacterClass = false;
      continue;
    }
    if (character === '/' && !inCharacterClass) {
      while (isIdentifierPart(source[index])) index += 1;
      return index;
    }
    if (character === '\n' || character === '\r') return index;
  }
  return index;
}

function scanTokens(source) {
  const tokens = [];

  const scanTemplate = start => {
    let index = start;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '`') return index + 1;
      if (character === '$' && source[index + 1] === '{') {
        index = scanCode(index + 2, true);
        continue;
      }
      index += 1;
    }
    return index;
  };

  const scanCode = (start, stopAtBrace) => {
    let braceDepth = 0;
    let index = start;
    while (index < source.length) {
      const character = source[index];
      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (index === 0 && character === '#' && source[index + 1] === '!') {
        index = source.indexOf('\n', index + 2);
        if (index === -1) return source.length;
        continue;
      }
      if (character === '/' && source[index + 1] === '/') {
        index = source.indexOf('\n', index + 2);
        if (index === -1) return source.length;
        continue;
      }
      if (character === '/' && source[index + 1] === '*') {
        const end = source.indexOf('*/', index + 2);
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (stopAtBrace && character === '}' && braceDepth === 0) return index + 1;
      if (character === "'" || character === '"') {
        const token = readString(source, index);
        tokens.push({ kind: 'string', value: token.value });
        index = token.index;
        continue;
      }
      if (character === '`') {
        index = scanTemplate(index + 1);
        continue;
      }
      if (isIdentifierStart(character)) {
        const startIndex = index;
        index += 1;
        while (isIdentifierPart(source[index])) index += 1;
        tokens.push({ kind: 'identifier', value: source.slice(startIndex, index) });
        continue;
      }
      if (/[0-9]/.test(character)) {
        const startIndex = index;
        index += 1;
        while (/[0-9A-Za-z_.]/.test(source[index] ?? '')) index += 1;
        tokens.push({ kind: 'number', value: source.slice(startIndex, index) });
        continue;
      }
      if (character === '/' && canStartRegex(tokens.at(-1))) {
        index = skipRegex(source, index);
        continue;
      }
      if (stopAtBrace && character === '{') braceDepth += 1;
      else if (stopAtBrace && character === '}') braceDepth -= 1;
      tokens.push({ kind: 'punctuation', value: character });
      index += 1;
    }
    return index;
  };

  scanCode(0, false);
  return tokens;
}

function statementEnd(tokens, start) {
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index]?.value === ';') return index;
  }
  return tokens.length;
}

function fromIndex(tokens, start, end) {
  for (let index = start; index < end; index++) {
    if (tokens[index]?.kind === 'identifier' && tokens[index]?.value === 'from') return index;
  }
  return -1;
}

function namedBindingsAreTypeOnly(tokens) {
  if (tokens[0]?.value !== '{') return false;
  let start = 1;
  let depth = 0;
  let sawBinding = false;
  for (let index = 1; index <= tokens.length; index++) {
    const value = tokens[index]?.value;
    if (value === '{' || value === '[') depth += 1;
    if (value === '}' || value === ']') {
      if (depth === 0) {
        const binding = tokens.slice(start, index);
        if (binding.length > 0) {
          sawBinding = true;
          if (binding[0]?.value !== 'type') return false;
        }
        break;
      }
      depth -= 1;
    }
    if (value === ',' && depth === 0) {
      const binding = tokens.slice(start, index);
      if (binding.length > 0) {
        sawBinding = true;
        if (binding[0]?.value !== 'type') return false;
      }
      start = index + 1;
    }
  }
  return sawBinding;
}

function staticReferenceKind(tokens) {
  if (tokens[0]?.value === 'type') return 'type';
  return namedBindingsAreTypeOnly(tokens) ? 'type' : 'runtime';
}

function parsedSpecifiers(source) {
  const tokens = scanTokens(source);
  const references = [];
  const add = (specifier, kind) => {
    if (typeof specifier !== 'string' || specifier.length === 0) return;
    const previous = references.find(reference => reference.specifier === specifier);
    if (previous === undefined) {
      references.push({ specifier, kind });
    } else if (kind === 'runtime') {
      previous.kind = 'runtime';
    }
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.kind === 'identifier' && token.value === 'import') {
      const next = tokens[index + 1];
      if (next?.value === '.') continue;
      if (next?.value === '(') {
        const literal = tokens[index + 2];
        if (literal?.kind === 'string') add(literal.value, 'runtime');
        continue;
      }
      if (next?.kind === 'string') {
        add(next.value, 'runtime');
        continue;
      }
      const end = statementEnd(tokens, index + 1);
      const from = fromIndex(tokens, index + 1, end);
      const literal = from < 0 ? undefined : tokens[from + 1];
      if (literal?.kind === 'string') {
        add(literal.value, staticReferenceKind(tokens.slice(index + 1, from)));
      }
      continue;
    }

    if (token?.kind === 'identifier' && token.value === 'export') {
      const end = statementEnd(tokens, index + 1);
      const from = fromIndex(tokens, index + 1, end);
      const literal = from < 0 ? undefined : tokens[from + 1];
      if (literal?.kind === 'string') {
        add(literal.value, staticReferenceKind(tokens.slice(index + 1, from)));
      }
      continue;
    }

    if (token?.kind === 'identifier' && token.value === 'require' && tokens[index + 1]?.value === '(') {
      const literal = tokens[index + 2];
      if (literal?.kind === 'string') add(literal.value, 'runtime');
    }
  }

  return references;
}

export function createImportGraph(root, source) {
  const packages = workspacePackages(root, source);

  const resolveSpecifier = (file, specifier) => {
    if (specifier.startsWith('.')) {
      const direct = resolve(dirname(file), specifier);
      if (existsSync(direct)) return direct;
      if (direct.endsWith('.js')) {
        for (const extension of ['.ts', '.tsx']) {
          const typeScript = `${direct.slice(0, -'.js'.length)}${extension}`;
          if (existsSync(typeScript)) return typeScript;
        }
      }
      if (direct.endsWith('.mjs')) {
        const typeScript = `${direct.slice(0, -'.mjs'.length)}.mts`;
        if (existsSync(typeScript)) return typeScript;
      }
      if (direct.endsWith('.cjs')) {
        const typeScript = `${direct.slice(0, -'.cjs'.length)}.cts`;
        if (existsSync(typeScript)) return typeScript;
      }
      for (const extension of ['.ts', '.tsx', '.mts', '.cts']) {
        const withTypeScript = `${direct}${extension}`;
        if (existsSync(withTypeScript)) return withTypeScript;
      }
      for (const name of ['index.ts', 'index.tsx', 'index.mts', 'index.cts']) {
        const barrel = join(direct, name);
        if (existsSync(barrel)) return barrel;
      }
      return direct;
    }

    const name = packageName(specifier);
    if (name === undefined) return null;
    const target = packages.get(name);
    if (target === undefined) return null;
    const subpath = specifier === name ? '.' : `./${specifier.slice(name.length + 1)}`;
    const exported = packageExportTarget(target, subpath);
    return exported === undefined ? null : resolve(target.dir, exported);
  };

  const importsOf = (file, sourceText, mode = 'ownership') => {
    if (mode !== 'ownership' && mode !== 'runtime') {
      throw new TypeError(`unknown import graph mode ${String(mode)}`);
    }
    return parsedSpecifiers(sourceText)
      .filter(reference => mode === 'ownership' || reference.kind === 'runtime')
      .map(reference => ({
        file,
        kind: reference.kind,
        packageName: packageName(reference.specifier),
        specifier: reference.specifier,
        resolved: resolveSpecifier(file, reference.specifier),
      }));
  };

  const findImportPath = (entry, matches, overlay = new Map(), mode = 'ownership') => {
    const seen = new Set();
    const queue = [[entry]];
    while (queue.length > 0) {
      const chain = queue.shift();
      const file = chain?.at(-1);
      if (file === undefined || seen.has(file)) continue;
      const sourceText = overlay.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
      if (sourceText === undefined) continue;
      seen.add(file);
      for (const imported of importsOf(file, sourceText, mode)) {
        if (matches(imported)) return [...chain, imported.specifier];
        if (imported.resolved !== null) queue.push([...chain, imported.resolved]);
      }
    }
    return null;
  };

  const reachCount = (entry, mode = 'ownership') => {
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift();
      if (file === undefined || seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const imported of importsOf(file, readFileSync(file, 'utf8'), mode)) {
        if (imported.resolved !== null) queue.push(imported.resolved);
      }
    }
    return seen.size;
  };

  return {
    packages,
    resolveSpecifier,
    importsOf,
    findImportPath,
    reachCount,
  };
}
