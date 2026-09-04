// Shared static import-graph walk for repository verification scripts.
//
// It follows relative `.js` specifiers to their TypeScript siblings and follows
// workspace package exports across package boundaries. The parser is purposely
// narrow: repository sources use ESM imports/re-exports and literal dynamic
// imports, which are the forms the gates need to reason about.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createImportGraph(root) {
  const packagesDir = join(root, 'packages');
  const packages = new Map();
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

  const resolveSpecifier = (file, specifier) => {
    if (specifier.startsWith('.')) {
      const direct = join(dirname(file), specifier);
      if (existsSync(direct)) return direct;
      if (direct.endsWith('.js')) {
        const typeScript = `${direct.slice(0, -'.js'.length)}.ts`;
        if (existsSync(typeScript)) return typeScript;
      }
      const withTypeScript = `${direct}.ts`;
      if (existsSync(withTypeScript)) return withTypeScript;
      const barrel = join(direct, 'index.ts');
      return existsSync(barrel) ? barrel : direct;
    }

    const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(\/.*)?$/.exec(specifier);
    if (match === null) return null;
    const target = packages.get(match[1]);
    if (target === undefined) return null;
    const exported = target.exports[`.${match[2] ?? ''}`];
    return typeof exported === 'string' ? join(target.dir, exported) : null;
  };

  const importsOf = (file, source) => {
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
    return [...new Set(specifiers)].map(specifier => ({
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
