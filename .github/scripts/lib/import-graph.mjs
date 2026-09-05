// Shared static import-graph walk for repository verification scripts.
//
// It follows relative `.js` specifiers to their TypeScript siblings and follows
// workspace package exports across package boundaries. The parser is purposely
// narrow: repository sources use ESM imports/re-exports and literal dynamic
// imports, which are the forms the gates need to reason about.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

function sourceTokens(source) {
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

function moduleSpecifiers(source) {
  const tokens = sourceTokens(source);
  const specifiers = [];

  const fromSpecifier = start => {
    for (let index = start; index < tokens.length; index++) {
      const token = tokens[index];
      if (token?.kind === 'punctuation' && token.value === ';') return undefined;
      if (token?.kind === 'identifier' && token.value === 'from') {
        const target = tokens[index + 1];
        if (target?.kind === 'string') return target.value;
      }
    }
    return undefined;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.kind !== 'identifier') continue;
    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (next?.kind === 'punctuation' && next.value === '.') continue;
      if (next?.kind === 'punctuation' && next.value === '(') {
        const target = tokens[index + 2];
        if (target?.kind === 'string') specifiers.push(target.value);
        continue;
      }
      if (next?.kind === 'string') {
        specifiers.push(next.value);
        continue;
      }
      const specifier = fromSpecifier(index + 1);
      if (specifier !== undefined) specifiers.push(specifier);
    } else if (token.value === 'export') {
      const specifier = fromSpecifier(index + 1);
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }

  return [...new Set(specifiers)];
}

function legacyModuleSpecifiers(source) {
  const specifiers = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  return [...new Set(specifiers)];
}

function workspacePackages(root, suppliedPackages) {
  const packagesDir = join(root, 'packages');
  const packages = new Map();
  if (suppliedPackages !== undefined) {
    for (const packageRecord of suppliedPackages) {
      packages.set(packageRecord.npmName, {
        dir: packageRecord.directoryPath,
        exports: packageRecord.manifest.exports ?? {},
      });
    }
    return packages;
  }

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof pkg.name === 'string') {
      packages.set(pkg.name, { dir, exports: pkg.exports ?? {} });
    }
  }
  return packages;
}

function exportedTarget(packageRecord, selector) {
  if (typeof packageRecord.exports === 'string') return selector === '.' ? packageRecord.exports : undefined;
  return packageRecord.exports[selector];
}

export function createImportGraph(root, suppliedPackages) {
  const packages = workspacePackages(root, suppliedPackages);
  // #725 supplies catalog-backed packages and needs lexical imports that exclude
  // import-shaped comments and generated source strings. Existing no-argument
  // consumers retain their frozen parser behavior until #726 migrates them.
  const readSpecifiers = suppliedPackages === undefined ? legacyModuleSpecifiers : moduleSpecifiers;

  const resolveSpecifier = (file, specifier) => {
    if (specifier.startsWith('.')) {
      const direct = join(dirname(file), specifier);
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

    const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(\/.*)?$/.exec(specifier);
    if (match === null) return null;
    const target = packages.get(match[1]);
    if (target === undefined) return null;
    const exported = exportedTarget(target, `.${match[2] ?? ''}`);
    return typeof exported === 'string' ? join(target.dir, exported) : null;
  };

  const importsOf = (file, source) => {
    return readSpecifiers(source).map(specifier => ({
      specifier,
      resolved: resolveSpecifier(file, specifier),
    }));
  };

  const findImportPath = (entry, matches, overlay = new Map()) => {
    const seen = new Set();
    const queue = [[entry]];
    while (queue.length > 0) {
      const chain = queue.shift();
      const file = chain?.at(-1);
      if (file === undefined || seen.has(file)) continue;
      const source = overlay.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
      if (source === undefined) continue;
      seen.add(file);
      for (const imported of importsOf(file, source)) {
        if (matches({ file, ...imported })) return [...chain, imported.specifier];
        if (imported.resolved !== null) queue.push([...chain, imported.resolved]);
      }
    }
    return null;
  };

  const reachCount = entry => {
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift();
      if (file === undefined || seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const imported of importsOf(file, readFileSync(file, 'utf8'))) {
        if (imported.resolved !== null) queue.push(imported.resolved);
      }
    }
    return seen.size;
  };

  return { packages, resolveSpecifier, importsOf, findImportPath, reachCount };
}
