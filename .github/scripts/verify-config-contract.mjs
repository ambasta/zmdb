#!/usr/bin/env node
// Enforce the single project-configuration owner frozen by #618 and implemented by #621.
//
// A package may consume or directly re-export the canonical contract. It may not
// declare a second public or private config contract, implement another loader,
// or publish another config entry point.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { createImportGraph } from './lib/import-graph.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCT_CONFIG = 'zmdb/config';
const COMPILER_CONFIG = '@zmdb/compiler/config';
const COMPILER_AUTHORING_CONFIG = '@zmdb/compiler/config/contract';
const PRODUCT_ROOT = 'zmdb';
const AUTHORING_NAMES = new Set(['HttpGenerationConfig', 'ZmdbConfig', 'ZmdbConfigData', 'defineConfig']);
const PROTECTED_NAMES = new Set([
  ...AUTHORING_NAMES,
  'LoadConfigOptions',
  'ResolvedConfig',
  'ResolvedHttpContractSource',
  'ResolvedHttpGenerationConfig',
  'loadConfig',
  'resolveConfig',
]);
const ROOT_AUTHORING_NAMES = new Set(['ZmdbConfig', 'defineConfig']);

function exportedSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
}

function publicEntries(architecture) {
  const entries = new Map();
  for (const packageRecord of architecture.packages) {
    const { manifest } = packageRecord;
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      if (typeof target !== 'string') continue;
      const path = resolve(packageRecord.directoryPath, target);
      const specifiers = entries.get(path) ?? [];
      specifiers.push(exportedSpecifier(packageRecord.npmName, subpath));
      entries.set(path, specifiers);
    }
  }
  return entries;
}

function findPublicEntry(entries, specifier) {
  for (const [path, specifiers] of entries) {
    if (specifiers.includes(specifier)) return path;
  }
  return undefined;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__fixtures__') files.push(...sourceFiles(path));
      continue;
    }
    if (
      entry.isFile() &&
      /\.[cm]?[jt]s$/.test(entry.name) &&
      !/\.d\.[cm]?ts$/.test(entry.name) &&
      !/\.spec\.[cm]?ts$/.test(entry.name) &&
      !/\.type-test\.[cm]?ts$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

function shippedSources(architecture) {
  return architecture.packages.flatMap(packageRecord => {
    const source = join(packageRecord.directoryPath, 'src');
    return existsSync(source) ? sourceFiles(source) : [];
  });
}

function sourceAt(root, path, overlays) {
  return overlays.get(path) ?? overlays.get(relative(root, path)) ?? readFileSync(path, 'utf8');
}

function declarations(source) {
  const found = [];
  const pattern =
    /^\s*(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(pattern)) {
    const name = match[2];
    if (name !== undefined && PROTECTED_NAMES.has(name)) {
      found.push({ name, exported: match[1] !== undefined });
    }
  }
  return found;
}

function exportNames(body) {
  return body
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map(part => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map(part => {
      const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      return match === null ? undefined : { imported: match[1], exported: match[2] ?? match[1] };
    })
    .filter(value => value !== undefined);
}

function reexports(source) {
  const exports = [];
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const body = match[1] ?? '';
    const specifier = match[2] ?? '';
    for (const names of exportNames(body)) {
      if (PROTECTED_NAMES.has(names.imported) || PROTECTED_NAMES.has(names.exported)) {
        exports.push({ ...names, specifier });
      }
    }
  }
  return exports;
}

function localExports(source) {
  const exports = [];
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}(\s+from\s+['"][^'"]+['"])?/g)) {
    if (match[2] !== undefined) continue;
    for (const names of exportNames(match[1] ?? '')) {
      if (PROTECTED_NAMES.has(names.imported) || PROTECTED_NAMES.has(names.exported)) exports.push(names);
    }
  }
  return exports;
}

function wildcardReexports(source) {
  return [...source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)].map(match => match[1] ?? '');
}

function declarationOwner(root, start, name, graph, overlays, seen = new Set()) {
  const file = resolve(start);
  if (seen.has(file) || !existsSync(file)) return undefined;
  seen.add(file);
  const source = sourceAt(root, file, overlays);
  if (declarations(source).some(declaration => declaration.exported && declaration.name === name)) return file;
  for (const item of reexports(source)) {
    if (item.exported !== name) continue;
    const target = graph.resolveSpecifier(file, item.specifier);
    if (target === null) continue;
    const found = declarationOwner(root, target, item.imported, graph, overlays, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isApprovedPublicExport(specifiers, name) {
  return specifiers.every(specifier => {
    if (specifier === PRODUCT_CONFIG || specifier === COMPILER_CONFIG || specifier === COMPILER_AUTHORING_CONFIG) {
      return true;
    }
    return specifier === PRODUCT_ROOT && ROOT_AUTHORING_NAMES.has(name);
  });
}

function runtimeImports(source) {
  const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
  const specifiers = [];
  for (const match of withoutComments.matchAll(
    /(?:^|[;\n])\s*import\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  )) {
    specifiers.push(match[1] ?? '');
  }
  for (const match of withoutComments.matchAll(
    /(?:^|[;\n])\s*export\s+(?!type\b)(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    specifiers.push(match[1] ?? '');
  }
  for (const match of withoutComments.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1] ?? '');
  }
  return [...new Set(specifiers.filter(Boolean))];
}

export function inspectConfigContract(root = ROOT, overlays = new Map(), options = {}) {
  const absoluteRoot = resolve(root);
  const { architecture } = options;
  if (architecture === undefined) {
    throw new TypeError('inspectConfigContract requires architecture from loadGovernanceSnapshot({ root })');
  }
  const graph = createImportGraph(absoluteRoot, architecture);
  const entries = publicEntries(architecture);
  const facade = findPublicEntry(entries, PRODUCT_CONFIG);
  const compilerOwner = findPublicEntry(entries, COMPILER_CONFIG);
  const owner = compilerOwner ?? facade;
  const problems = [];

  if (facade === undefined) problems.push(`${PRODUCT_CONFIG} has no published export`);
  if (owner === undefined) {
    problems.push('the canonical project-config owner is missing');
    return { owner: '', authoringOwner: '', facade: facade ?? '', problems };
  }

  const authoringOwner = declarationOwner(absoluteRoot, owner, 'defineConfig', graph, overlays) ?? owner;
  const expectedOwner = name => (AUTHORING_NAMES.has(name) ? authoringOwner : owner);
  const approvedModules = name =>
    new Set([expectedOwner(name), owner, ...(facade === undefined ? [] : [facade])].map(path => resolve(path)));

  for (const specifier of runtimeImports(sourceAt(absoluteRoot, authoringOwner, overlays))) {
    problems.push(
      `${relative(absoluteRoot, authoringOwner)} imports ${specifier} at runtime; the authoring contract must be dependency-free`,
    );
  }

  if (facade !== undefined) {
    for (const name of PROTECTED_NAMES) {
      const found = declarationOwner(absoluteRoot, facade, name, graph, overlays);
      if (found === undefined) {
        problems.push(`${PRODUCT_CONFIG} does not expose ${name}`);
      } else if (resolve(found) !== resolve(expectedOwner(name))) {
        problems.push(
          `${PRODUCT_CONFIG} exposes ${name} from ${relative(absoluteRoot, found)}; canonical owner is ${relative(absoluteRoot, expectedOwner(name))}`,
        );
      }
    }
  }

  for (const file of shippedSources(architecture)) {
    const source = sourceAt(absoluteRoot, file, overlays);
    const publicSpecifiers = entries.get(file) ?? [];

    for (const declaration of declarations(source)) {
      const expected = expectedOwner(declaration.name);
      if (file !== expected) {
        problems.push(
          `${relative(absoluteRoot, file)} declares ${declaration.exported ? 'exported' : 'private'} ${declaration.name}; canonical owner is ${relative(absoluteRoot, expected)}`,
        );
      } else if (!declaration.exported) {
        problems.push(`${relative(absoluteRoot, file)} declares private canonical ${declaration.name}`);
      } else if (!isApprovedPublicExport(publicSpecifiers, declaration.name)) {
        problems.push(
          `${relative(absoluteRoot, file)} exposes ${declaration.name} through an unapproved public config entry`,
        );
      }
    }

    for (const names of localExports(source)) {
      const expected = expectedOwner(names.imported);
      if (file !== expected) {
        problems.push(
          `${relative(absoluteRoot, file)} locally exports ${names.exported}; config exports must come directly from ${relative(absoluteRoot, expected)}`,
        );
      }
    }

    for (const item of reexports(source)) {
      const target = graph.resolveSpecifier(file, item.specifier);
      const expected = expectedOwner(item.imported);
      if (target === null || !approvedModules(item.imported).has(resolve(target))) {
        problems.push(
          `${relative(absoluteRoot, file)} re-exports ${item.exported} from ${item.specifier}; canonical owner is ${relative(absoluteRoot, expected)}`,
        );
        continue;
      }
      if (publicSpecifiers.length > 0 && !isApprovedPublicExport(publicSpecifiers, item.exported)) {
        problems.push(
          `${relative(absoluteRoot, file)} publishes ${item.exported} through ${publicSpecifiers.join(', ')} instead of ${PRODUCT_CONFIG}`,
        );
      }
    }

    for (const specifier of wildcardReexports(source)) {
      const target = graph.resolveSpecifier(file, specifier);
      if (
        target !== null &&
        [...PROTECTED_NAMES].some(name => approvedModules(name).has(resolve(target))) &&
        (file !== owner || publicSpecifiers.some(entry => entry !== PRODUCT_CONFIG && entry !== COMPILER_CONFIG))
      ) {
        problems.push(
          `${relative(absoluteRoot, file)} wildcard-re-exports the project config contract from ${specifier}`,
        );
      }
    }
  }

  return {
    owner: relative(absoluteRoot, owner),
    authoringOwner: relative(absoluteRoot, authoringOwner),
    facade: facade === undefined ? '' : relative(absoluteRoot, facade),
    problems: problems.toSorted(),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
  if (snapshot.architecture === null) throw new Error('governance snapshot has no architecture');
  const report = inspectConfigContract(ROOT, new Map(), { architecture: snapshot.architecture });
  if (report.problems.length > 0) {
    for (const problem of report.problems) process.stderr.write(`[ERROR] ${problem}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `[SUCCESS] ${PRODUCT_CONFIG} is the sole project-config contract ` +
        `(${report.authoringOwner}; loader ${report.owner}).\n`,
    );
  }
}
