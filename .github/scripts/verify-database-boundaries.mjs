#!/usr/bin/env node
// Freeze the database-package extraction boundary from issue #667.
//
// The implementation is intentionally a ratchet while the extraction is incomplete:
// current vendor-owned code in generic packages and absent package/consumer artifacts
// are recorded in database-boundary-baseline.json. The verifier fails on both a new
// finding and a stale finding, so every implementation issue has to remove the exact
// gaps it closes. Tests assert the target zero state with `it.fails`.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SyntaxKind } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

import {
  DATABASE_CAPABILITY_KEYS,
  DATABASE_CAPABILITY_MATRIX,
  FAMILY_PARENTS,
  OFFICIAL_DATABASES,
  SQL_TYPE_KEYS,
  VERTICAL_CONTRACT_KEYS,
} from '../../packages/query-compiler/src/testing/capability-matrix.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const GENERIC_PACKAGES = ['query-compiler', 'schema-core', 'repository'];
const GENERIC_PACKAGE_NAMES = GENERIC_PACKAGES.map(name => `@zmdb/${name}`);
const DATABASE_CLIENTS = [
  'pg',
  'postgres',
  'mysql',
  'mysql2',
  'mssql',
  'tedious',
  'better-sqlite3',
  'sqlite3',
  '@libsql/client',
  '@neondatabase/serverless',
  '@planetscale/database',
  'node:sqlite',
];
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
const ASSIGNMENTS = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);
const MUTATING_METHODS = new Set([
  'add',
  'clear',
  'delete',
  'pop',
  'push',
  'reverse',
  'set',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
const BASELINE_PATH = join(ROOT, '.github', 'scripts', 'database-boundary-baseline.json');
const FIXTURE_DIR = join(ROOT, '.github', 'scripts', '__fixtures__', 'database-boundaries');
const MSSQL_COMPATIBILITY_PATHS = new Set(['packages/query-compiler/src/dialects/index.ts']);
const MSSQL_IMPLEMENTATION_MARKERS = [
  ['output-clause', /\bOUTPUT\b/g],
  ['merge-statement', /\bMERGE\b/g],
  ['holdlock-hint', /\bHOLDLOCK\b/g],
  ['unicode-type', /\bNVARCHAR\b/g],
  ['timestamp-type', /\bDATETIMEOFFSET\b/g],
  ['timestamp-default', /\bSYSDATETIMEOFFSET\b/g],
  ['identity-column', /\bIDENTITY\s*\(/g],
  ['catalog-object-probe', /\bOBJECT_ID\s*\(/g],
  ['offset-fetch', /\bFETCH\s+NEXT\b/g],
];

function canonicalDatabase(value) {
  return value.toLowerCase() === 'postgresql' ? 'postgres' : value.toLowerCase();
}

function officialNames(value) {
  const found = new Set();
  for (const match of value.matchAll(/postgresql|postgres|mysql|sqlite|mssql|cockroach|singlestore/gi)) {
    found.add(canonicalDatabase(match[0]));
  }
  return [...found];
}

function packageSpecifier(specifier) {
  const match = /^@zmdb\/(sqlite|postgres|mysql|mssql|cockroach|singlestore)(?:\/|$)/.exec(specifier);
  return match?.[1];
}

function isClientSpecifier(specifier) {
  return DATABASE_CLIENTS.some(client => specifier === client || specifier.startsWith(`${client}/`));
}

export function isShippedGenericSource(path) {
  if (!GENERIC_PACKAGES.some(name => path.startsWith(`packages/${name}/src/`))) {
    return false;
  }
  return isShippedPackageSource(path);
}

function isShippedPackageSource(path) {
  if (!/^packages\/[^/]+\/src\//.test(path)) return false;
  if (!/\.[cm]?tsx?$/.test(path) || path.endsWith('.d.ts')) return false;
  return ![
    /\.spec\.[cm]?tsx?$/,
    /\.type-test\.[cm]?tsx?$/,
    /\.generated\.[cm]?tsx?$/,
    /(?:^|\/)[^/]*[.-]fixture\.[cm]?tsx?$/,
    /\/__fixtures__\//,
    /\/fixtures\//,
    /\/__testing__\//,
    /\/testing\//,
  ].some(pattern => pattern.test(path));
}

function lineOf(sourceFile, node) {
  return sourceFile.text.slice(0, node.getStart()).split('\n').length;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function walk(node, visit) {
  visit(node);
  node.forEachChild(child => walk(child, visit));
}

function moduleSpecifier(node) {
  const value = node.moduleSpecifier;
  return value?.kind === SyntaxKind.StringLiteral ? value.text : undefined;
}

function importLocals(node) {
  const names = [];
  const clause = node.importClause;
  if (clause?.name?.kind === SyntaxKind.Identifier) names.push(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings?.kind === SyntaxKind.NamespaceImport) names.push(bindings.name.text);
  if (bindings?.kind === SyntaxKind.NamedImports) {
    for (const element of bindings.elements) names.push(element.name.text);
  }
  return names;
}

function expressionRoot(node) {
  let current = node;
  while (current !== undefined) {
    if (current.kind === SyntaxKind.Identifier) return current.text;
    if (current.kind === SyntaxKind.PropertyAccessExpression || current.kind === SyntaxKind.ElementAccessExpression) {
      current = current.expression;
      continue;
    }
    if (
      current.kind === SyntaxKind.ParenthesizedExpression ||
      current.kind === SyntaxKind.AsExpression ||
      current.kind === SyntaxKind.SatisfiesExpression ||
      current.kind === SyntaxKind.NonNullExpression ||
      current.kind === SyntaxKind.TypeAssertionExpression
    ) {
      current = current.expression;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function callSpecifier(node) {
  if (node.kind !== SyntaxKind.CallExpression) return undefined;
  if (node.expression?.kind !== SyntaxKind.ImportKeyword || node.arguments?.[0]?.kind !== SyntaxKind.StringLiteral) {
    return undefined;
  }
  return node.arguments[0].text;
}

function isModuleLiteral(node) {
  const parent = node.parent;
  return (
    parent?.kind === SyntaxKind.ImportDeclaration ||
    parent?.kind === SyntaxKind.ExportDeclaration ||
    (parent?.kind === SyntaxKind.CallExpression && parent.expression?.kind === SyntaxKind.ImportKeyword)
  );
}

function mutationRoot(node) {
  if (node.kind === SyntaxKind.BinaryExpression && ASSIGNMENTS.has(node.operatorToken?.kind)) {
    return expressionRoot(node.left);
  }
  if (node.kind === SyntaxKind.PrefixUnaryExpression || node.kind === SyntaxKind.PostfixUnaryExpression) {
    if (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken) {
      return expressionRoot(node.operand);
    }
  }
  if (node.kind !== SyntaxKind.CallExpression) return undefined;

  if (
    node.expression?.kind === SyntaxKind.PropertyAccessExpression &&
    MUTATING_METHODS.has(node.expression.name.text)
  ) {
    return expressionRoot(node.expression.expression);
  }

  if (
    node.expression?.kind === SyntaxKind.PropertyAccessExpression &&
    node.expression.expression?.kind === SyntaxKind.Identifier &&
    ((node.expression.expression.text === 'Object' && node.expression.name.text === 'assign') ||
      (node.expression.expression.text === 'Reflect' && node.expression.name.text === 'set'))
  ) {
    return expressionRoot(node.arguments?.[0]);
  }
  return undefined;
}

function findingCollector() {
  const byKey = new Map();
  const add = (kind, path, token, line) => {
    const key = `${kind}\u0000${path}\u0000${token}`;
    const previous = byKey.get(key);
    if (previous === undefined) {
      byKey.set(key, {
        kind,
        path,
        token,
        count: 1,
        lines: line === undefined ? [] : [line],
      });
      return;
    }
    previous.count += 1;
    if (line !== undefined && !previous.lines.includes(line)) previous.lines.push(line);
  };
  return {
    add,
    values: () =>
      [...byKey.values()]
        .map(finding => ({
          ...finding,
          lines: finding.lines.toSorted((left, right) => left - right),
        }))
        .toSorted((left, right) =>
          `${left.kind}\u0000${left.path}\u0000${left.token}`.localeCompare(
            `${right.kind}\u0000${right.path}\u0000${right.token}`,
          ),
        ),
  };
}

function analyzeSourceFile(sourceFile, logicalPath, add) {
  if (!isShippedPackageSource(logicalPath)) return;
  const databasePackage = /^packages\/(sqlite|postgres|mysql|mssql|cockroach|singlestore)\//.exec(logicalPath)?.[1];
  const generic = isShippedGenericSource(logicalPath);
  if (!generic && databasePackage === undefined) return;
  const childPackage =
    databasePackage === 'cockroach' || databasePackage === 'singlestore' ? databasePackage : undefined;
  const expectedParent = childPackage === undefined ? undefined : FAMILY_PARENTS[childPackage];
  const importedParentNames = new Set();

  walk(sourceFile, node => {
    if (node.kind === SyntaxKind.ImportDeclaration || node.kind === SyntaxKind.ExportDeclaration) {
      const specifier = moduleSpecifier(node);
      if (specifier !== undefined) {
        const officialPackage = packageSpecifier(specifier);
        if (officialPackage !== undefined && generic) {
          add('official-package-import', logicalPath, specifier, lineOf(sourceFile, node));
        }
        if (isClientSpecifier(specifier) && generic) {
          add('database-client-import', logicalPath, specifier, lineOf(sourceFile, node));
        }
        if (officialPackage !== undefined && databasePackage !== undefined && officialPackage !== expectedParent) {
          add(
            FAMILY_PARENTS[officialPackage] === databasePackage ? 'database-reverse-edge' : 'database-package-edge',
            logicalPath,
            `${databasePackage}->${officialPackage}`,
            lineOf(sourceFile, node),
          );
        }
        if (node.kind === SyntaxKind.ImportDeclaration && officialPackage === expectedParent) {
          for (const name of importLocals(node)) importedParentNames.add(name);
        }
      }
    }

    const dynamicSpecifier = callSpecifier(node);
    if (dynamicSpecifier !== undefined) {
      const officialPackage = packageSpecifier(dynamicSpecifier);
      if (officialPackage !== undefined && generic) {
        add('official-package-import', logicalPath, dynamicSpecifier, lineOf(sourceFile, node));
      }
      if (isClientSpecifier(dynamicSpecifier) && generic) {
        add('database-client-import', logicalPath, dynamicSpecifier, lineOf(sourceFile, node));
      }
      if (officialPackage !== undefined && databasePackage !== undefined && officialPackage !== expectedParent) {
        add(
          FAMILY_PARENTS[officialPackage] === databasePackage ? 'database-reverse-edge' : 'database-package-edge',
          logicalPath,
          `${databasePackage}->${officialPackage}`,
          lineOf(sourceFile, node),
        );
      }
    }

    if (generic && node.kind === SyntaxKind.Identifier) {
      for (const database of officialNames(node.text)) {
        add('official-name', logicalPath, database, lineOf(sourceFile, node));
        if (database === 'mssql' && !MSSQL_COMPATIBILITY_PATHS.has(logicalPath)) {
          add('sql-server-implementation', logicalPath, 'name-or-branch', lineOf(sourceFile, node));
        }
      }
    }
    if (
      (node.kind === SyntaxKind.StringLiteral || node.kind === SyntaxKind.NoSubstitutionTemplateLiteral) &&
      generic &&
      !isModuleLiteral(node)
    ) {
      for (const database of officialNames(node.text)) {
        add('official-name', logicalPath, database, lineOf(sourceFile, node));
        if (database === 'mssql' && !MSSQL_COMPATIBILITY_PATHS.has(logicalPath)) {
          add('sql-server-implementation', logicalPath, 'name-or-branch', lineOf(sourceFile, node));
        }
      }
    }

    const root = mutationRoot(node);
    if (root !== undefined && importedParentNames.has(root)) {
      add('parent-mutation', logicalPath, root, lineOf(sourceFile, node));
    }
  });

  if (generic) {
    for (const [label, pattern] of MSSQL_IMPLEMENTATION_MARKERS) {
      pattern.lastIndex = 0;
      for (const match of sourceFile.text.matchAll(pattern)) {
        add('sql-server-implementation', logicalPath, label, lineAt(sourceFile.text, match.index));
      }
    }
  }
}

function sourceFilesForProjects(root, projects) {
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: projects });
    const sourceFiles = new Map();
    for (const project of snapshot.getProjects()) {
      for (const fileName of project.program.getSourceFileNames()) {
        const sourceFile = project.program.getSourceFile(fileName);
        if (sourceFile !== undefined) sourceFiles.set(fileName, sourceFile);
      }
    }
    return sourceFiles;
  } finally {
    api.close();
  }
}

function analyzeLiveSources(root, add) {
  const projects = [...GENERIC_PACKAGES, ...OFFICIAL_DATABASES]
    .map(name => join(root, 'packages', name, 'tsconfig.json'))
    .filter(existsSync);
  const sourceFiles = sourceFilesForProjects(root, projects);
  let shippedFiles = 0;
  for (const [fileName, sourceFile] of sourceFiles) {
    const logicalPath = relative(root, fileName);
    if (!isShippedPackageSource(logicalPath)) continue;
    shippedFiles += 1;
    analyzeSourceFile(sourceFile, logicalPath, add);
  }
  return shippedFiles;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageManifests(root) {
  const manifests = new Map();
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return manifests;
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const path = join(dir, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = readJson(path);
    if (typeof manifest.name === 'string') {
      manifests.set(manifest.name, {
        dir,
        manifest,
        path: relative(root, path),
      });
    }
  }
  return manifests;
}

function sourceFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(path));
    else if (
      entry.isFile() &&
      /\.[cm]?tsx?$/.test(entry.name) &&
      !/\.spec\.[cm]?tsx?$/.test(entry.name) &&
      !/\.type-test\.[cm]?tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(path);
    }
  }
  return found;
}

function dependencyEntries(manifest) {
  return DEPENDENCY_FIELDS.flatMap(field => Object.keys(manifest[field] ?? {}).map(name => ({ field, name })));
}

function manifestModel(root) {
  const manifests = packageManifests(root);
  const sourceCounts = new Map();
  for (const [name, entry] of manifests) {
    sourceCounts.set(name, sourceFilesUnder(join(entry.dir, 'src')).length);
  }
  return { manifests, sourceCounts };
}

function analyzeManifests(model, add) {
  for (const generic of GENERIC_PACKAGE_NAMES) {
    const entry = model.manifests.get(generic);
    if (entry === undefined) continue;
    for (const { field, name } of dependencyEntries(entry.manifest)) {
      if (!isClientSpecifier(name)) continue;
      add(
        field === 'devDependencies' ? 'generic-client-dev-dependency' : 'generic-client-dependency',
        entry.path,
        `${field}:${name}`,
      );
    }
  }

  for (const database of OFFICIAL_DATABASES) {
    const packageName = `@zmdb/${database}`;
    const entry = model.manifests.get(packageName);
    if (entry === undefined) {
      add('missing-package', `packages/${database}`, packageName);
      continue;
    }
    if ((model.sourceCounts.get(packageName) ?? 0) === 0) {
      add('empty-package', `packages/${database}`, packageName);
    }
    for (const { field, name } of dependencyEntries(entry.manifest)) {
      const target = packageSpecifier(name);
      if (target === undefined) continue;
      const allowedParent = FAMILY_PARENTS[database];
      if (target !== allowedParent) {
        const reverse = FAMILY_PARENTS[target] === database ? 'database-reverse-edge' : 'database-package-edge';
        add(reverse, entry.path, `${field}:${database}->${target}`);
      }
    }
  }
}

function isEvidence(value) {
  if (value === null || typeof value !== 'object') return false;
  if (value.kind === 'expectation') {
    return ['string', 'number', 'boolean'].includes(typeof value.value);
  }
  return value.kind === 'refusal' && typeof value.feature === 'string' && value.feature.length > 0;
}

function compareKeys(value, expected) {
  if (value === null || typeof value !== 'object') return false;
  const actual = Object.keys(value).toSorted();
  const wanted = [...expected].toSorted();
  return actual.length === wanted.length && actual.every((name, index) => name === wanted[index]);
}

function analyzeCapabilityMatrix(matrix, add) {
  if (!compareKeys(matrix, OFFICIAL_DATABASES)) {
    add('incomplete-capability-matrix', 'capability-matrix', 'database rows');
    return;
  }
  for (const database of OFFICIAL_DATABASES) {
    const row = matrix[database];
    for (const [section, expected] of [
      ['capabilities', DATABASE_CAPABILITY_KEYS],
      ['sqlTypes', SQL_TYPE_KEYS],
      ['verticals', VERTICAL_CONTRACT_KEYS],
    ]) {
      const values = row?.[section];
      if (!compareKeys(values, expected)) {
        add('incomplete-capability-matrix', 'capability-matrix', `${database}.${section}`);
        continue;
      }
      for (const key of expected) {
        if (!isEvidence(values[key])) {
          add('incomplete-capability-matrix', 'capability-matrix', `${database}.${section}.${key}`);
        }
      }
    }
    if (row?.packedConsumer !== `fixtures/database-${database}`) {
      add('incomplete-capability-matrix', 'capability-matrix', `${database}.packedConsumer`);
    }
  }
}

function packedConsumerState(root, path, packageName) {
  const dir = join(root, path);
  if (!existsSync(dir)) return { state: 'missing' };
  const manifestPath = join(dir, 'package.json');
  const tsconfigPath = join(dir, 'tsconfig.json');
  const sources = sourceFilesUnder(join(dir, 'src'));
  if (!existsSync(manifestPath) || !existsSync(tsconfigPath) || sources.length === 0) {
    return { state: 'incomplete' };
  }
  const manifest = readJson(manifestPath);
  const tsconfig = readJson(tsconfigPath);
  const importsPackage = sources.some(
    file =>
      readFileSync(file, 'utf8').includes(`'${packageName}'`) ||
      readFileSync(file, 'utf8').includes(`"${packageName}"`),
  );
  const declaresPackage = dependencyEntries(manifest).some(entry => entry.name === packageName);
  const hasPaths = tsconfig.compilerOptions?.paths !== undefined;
  return {
    state: importsPackage && declaresPackage && !hasPaths ? 'valid' : 'incomplete',
  };
}

function analyzePackedConsumers(root, model, matrix, add) {
  const records = new Map();
  for (const database of OFFICIAL_DATABASES) {
    const packageName = `@zmdb/${database}`;
    const path = matrix[database]?.packedConsumer;
    if (typeof path !== 'string') continue;
    records.set(database, packedConsumerState(root, path, packageName));
  }
  analyzePackedConsumerRecords(records, model, matrix, add);
}

function analyzePackedConsumerRecords(records, model, matrix, add) {
  for (const database of OFFICIAL_DATABASES) {
    const packageName = `@zmdb/${database}`;
    const path = matrix[database]?.packedConsumer;
    if (typeof path !== 'string') continue;
    const state = records.get(database) ?? { state: 'missing' };
    if (state.state === 'missing') {
      add('missing-packed-consumer', path, packageName);
    } else if (state.state !== 'valid') {
      add('invalid-packed-consumer', path, packageName);
    }
    if (!model.manifests.has(packageName) && state.state === 'valid') {
      add('unbacked-packed-consumer', path, packageName);
    }
  }
}

export async function inspectDatabaseBoundaries(root = ROOT) {
  const collector = findingCollector();
  const shippedFiles = analyzeLiveSources(root, collector.add);
  const model = manifestModel(root);
  analyzeManifests(model, collector.add);
  analyzeCapabilityMatrix(DATABASE_CAPABILITY_MATRIX, collector.add);
  analyzePackedConsumers(root, model, DATABASE_CAPABILITY_MATRIX, collector.add);
  return {
    findings: collector.values(),
    shippedFiles,
    manifests: model.manifests.size,
  };
}

export function findingSignature(finding) {
  return [finding.kind, finding.path, finding.token, String(finding.count)].join('|');
}

function fixtureSourceFiles() {
  const project = join(FIXTURE_DIR, 'tsconfig.json');
  return sourceFilesForProjects(ROOT, [project]);
}

function analyzeFixtureFile(sourceFiles, name, logicalPath) {
  const actualPath = join(FIXTURE_DIR, name);
  const sourceFile = sourceFiles.get(actualPath);
  if (sourceFile === undefined) throw new Error(`fixture source not loaded: ${name}`);
  const collector = findingCollector();
  analyzeSourceFile(sourceFile, logicalPath, collector.add);
  return collector.values();
}

function positiveModel() {
  const manifests = new Map();
  const sourceCounts = new Map();
  const add = (name, dependencies = {}) => {
    manifests.set(name, {
      path: `packages/${name.replace('@zmdb/', '')}/package.json`,
      dir: `packages/${name.replace('@zmdb/', '')}`,
      manifest: { name, dependencies },
    });
    sourceCounts.set(name, 1);
  };
  for (const generic of GENERIC_PACKAGE_NAMES) add(generic);
  for (const database of OFFICIAL_DATABASES) {
    const parent = FAMILY_PARENTS[database];
    add(`@zmdb/${database}`, parent === undefined ? {} : { [`@zmdb/${parent}`]: 'workspace:^' });
  }
  return { manifests, sourceCounts };
}

function modelFindings(model, matrix = DATABASE_CAPABILITY_MATRIX) {
  const collector = findingCollector();
  analyzeManifests(model, collector.add);
  analyzeCapabilityMatrix(matrix, collector.add);
  return collector.values();
}

function packedModelFindings(model, records, matrix = DATABASE_CAPABILITY_MATRIX) {
  const collector = findingCollector();
  analyzePackedConsumerRecords(records, model, matrix, collector.add);
  return collector.values();
}

function expectFixture(condition, message, failures) {
  if (!condition) failures.push(message);
}

export async function runDatabaseBoundaryFixtureProofs() {
  const failures = [];
  const sources = fixtureSourceFiles();
  const sourceCase = (name, logicalPath) => analyzeFixtureFile(sources, name, logicalPath);

  expectFixture(
    sourceCase('positive-generic.ts', 'packages/query-compiler/src/generic.ts').length === 0,
    'positive generic source produced a finding',
    failures,
  );
  expectFixture(
    sourceCase('excluded-test.ts', 'packages/query-compiler/src/excluded.spec.ts').length === 0,
    'spec source was treated as shipped source',
    failures,
  );
  expectFixture(
    sourceCase('__fixtures__/excluded.ts', 'packages/query-compiler/src/__fixtures__/excluded.ts').length === 0,
    'fixture source was treated as shipped source',
    failures,
  );

  for (const [name, logicalPath, kind] of [
    ['negative-official-name.ts', 'packages/query-compiler/src/official-name.ts', 'official-name'],
    ['negative-official-import.ts', 'packages/query-compiler/src/official-import.ts', 'official-package-import'],
    ['negative-client-import.ts', 'packages/query-compiler/src/client-import.ts', 'database-client-import'],
    [
      'negative-mssql-implementation.ts',
      'packages/query-compiler/src/mssql-implementation.ts',
      'sql-server-implementation',
    ],
  ]) {
    const findings = sourceCase(name, logicalPath);
    expectFixture(
      findings.some(finding => finding.kind === kind),
      `${name} did not produce ${kind}`,
      failures,
    );
  }

  const parentMutation = sourceCase('negative-parent-mutation.ts', 'packages/cockroach/src/index.ts');
  expectFixture(
    parentMutation.some(finding => finding.kind === 'parent-mutation'),
    'parent mutation fixture was not rejected',
    failures,
  );

  const positive = positiveModel();
  expectFixture(
    modelFindings(positive).length === 0,
    'positive manifest/capability model produced a finding',
    failures,
  );

  const validConsumers = new Map(OFFICIAL_DATABASES.map(database => [database, { state: 'valid' }]));
  expectFixture(
    packedModelFindings(positive, validConsumers).length === 0,
    'positive packed-consumer model produced a finding',
    failures,
  );

  const clientDependency = positiveModel();
  clientDependency.manifests.get('@zmdb/repository').manifest.dependencies.pg = '^8.0.0';
  expectFixture(
    modelFindings(clientDependency).some(finding => finding.kind === 'generic-client-dependency'),
    'generic client dependency fixture was not rejected',
    failures,
  );

  const missingConsumer = new Map(validConsumers);
  missingConsumer.delete('sqlite');
  expectFixture(
    packedModelFindings(positive, missingConsumer).some(finding => finding.kind === 'missing-packed-consumer'),
    'missing packed-consumer fixture was not rejected',
    failures,
  );

  const emptyPackage = positiveModel();
  emptyPackage.sourceCounts.set('@zmdb/sqlite', 0);
  expectFixture(
    modelFindings(emptyPackage).some(finding => finding.kind === 'empty-package'),
    'manifest-only database package was not rejected',
    failures,
  );

  const reverseEdge = positiveModel();
  reverseEdge.manifests.get('@zmdb/postgres').manifest.dependencies['@zmdb/cockroach'] = 'workspace:^';
  expectFixture(
    modelFindings(reverseEdge).some(finding => finding.kind === 'database-reverse-edge'),
    'family reverse-edge fixture was not rejected',
    failures,
  );

  const incomplete = structuredClone(DATABASE_CAPABILITY_MATRIX);
  delete incomplete.sqlite.capabilities.cancellation;
  expectFixture(
    modelFindings(positive, incomplete).some(finding => finding.kind === 'incomplete-capability-matrix'),
    'missing capability fixture was not rejected',
    failures,
  );

  if (failures.length > 0) {
    throw new Error(`database-boundary fixture proofs failed:\n${failures.join('\n')}`);
  }
  return {
    astCases: 8,
    modelCases: 7,
  };
}

function compareBaseline(findings, baseline) {
  const actual = findings.map(findingSignature).toSorted();
  const expected = [...baseline.findings].toSorted();
  return {
    added: actual.filter(signature => !expected.includes(signature)),
    stale: expected.filter(signature => !actual.includes(signature)),
  };
}

function printFindings(findings) {
  for (const finding of findings) {
    const lines = finding.lines.length === 0 ? '' : ` lines ${finding.lines.join(',')}`;
    console.log(
      `  ${finding.kind}: ${finding.path} -> ${finding.token} (${String(finding.count)} occurrence(s)${lines})`,
    );
  }
}

async function main(argv) {
  if (argv.includes('--self-test')) {
    const result = await runDatabaseBoundaryFixtureProofs();
    console.log(
      `database-boundary fixtures: ${String(result.astCases)} AST case(s), ` +
        `${String(result.modelCases)} manifest/capability case(s) passed.`,
    );
    return 0;
  }

  const report = await inspectDatabaseBoundaries();
  if (argv.includes('--print-baseline')) {
    console.log(
      JSON.stringify(
        {
          version: 1,
          findings: report.findings.map(findingSignature).toSorted(),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const baseline = readJson(BASELINE_PATH);
  const comparison = compareBaseline(report.findings, baseline);
  console.log(
    `database boundaries: ${String(report.shippedFiles)} shipped generic source file(s), ` +
      `${String(report.manifests)} manifest(s), ${String(report.findings.length)} frozen gap(s).`,
  );
  printFindings(report.findings);
  if (comparison.added.length > 0 || comparison.stale.length > 0) {
    if (comparison.added.length > 0) {
      console.error('\nnew database-boundary findings:');
      for (const signature of comparison.added) console.error(`  ${signature}`);
    }
    if (comparison.stale.length > 0) {
      console.error('\nstale database-boundary baseline entries:');
      for (const signature of comparison.stale) console.error(`  ${signature}`);
    }
    return 1;
  }
  console.log('database boundary ratchet: every current gap is explicit and no new gap was introduced.');
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
