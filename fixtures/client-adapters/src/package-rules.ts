import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { AdapterPackageExpectation } from './package-matrix.js';

export interface AdapterPackageManifest {
  readonly name?: string;
  readonly type?: string;
  readonly sideEffects?: boolean;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

const FORBIDDEN_SERVER_PACKAGES = new Set([
  '@zmdb/app',
  '@zmdb/jobs',
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
  '@zmdb/protobuf',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
  '@zmdb/web',
  'zmdb',
]);

const FORBIDDEN_DATA_PACKAGES = new Set([
  '@libsql/client',
  '@mikro-orm/core',
  '@prisma/client',
  '@zmdb/aot-validator',
  '@zmdb/compiler',
  '@zmdb/migrations',
  '@zmdb/orm',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/schema',
  '@zmdb/schema-core',
  '@zmdb/sql',
  '@zmdb/validator',
  'better-sqlite3',
  'drizzle-orm',
  'kysely',
  'mariadb',
  'mikro-orm',
  'mssql',
  'mysql',
  'mysql2',
  'pg',
  'postgres',
  'prisma',
  'sqlite3',
  'tedious',
]);

const DUPLICATED_HTTP_PACKAGES = new Set(['axios', 'cross-fetch', 'got', 'ky', 'node-fetch', 'superagent', 'undici']);

const PRIVATE_HARNESS_NAMES = new Set(['@zmdb-fixture/client-adapters', '@zmdb/client-adapters']);

function json(value: unknown): string {
  return JSON.stringify(value);
}

function entries(value: Readonly<Record<string, string>> | undefined): readonly [string, string][] {
  return Object.entries(value ?? {}).toSorted(([left], [right]) => left.localeCompare(right));
}

function forbiddenDependencyReason(name: string): string | undefined {
  if (FORBIDDEN_SERVER_PACKAGES.has(name)) return 'server dependency';
  if (
    FORBIDDEN_DATA_PACKAGES.has(name) ||
    /^@zmdb\/(?:cockroach|mssql|mysql|postgres|singlestore|sqlite)$/.test(name)
  ) {
    return 'ORM or database dependency';
  }
  if (DUPLICATED_HTTP_PACKAGES.has(name)) return 'duplicated HTTP dependency';
  return undefined;
}

function optionalPeers(manifest: AdapterPackageManifest): readonly string[] {
  return Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata.optional === true)
    .map(([name]) => name)
    .toSorted();
}

export function readAdapterPackageManifest(
  root: string,
  expectation: AdapterPackageExpectation,
): AdapterPackageManifest {
  const path = join(root, 'packages', expectation.directory, 'package.json');
  if (!existsSync(path)) throw new Error(`${expectation.name} manifest is missing at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as AdapterPackageManifest;
}

export function adapterManifestProblems(
  expectation: AdapterPackageExpectation,
  manifest: AdapterPackageManifest,
): readonly string[] {
  const problems: string[] = [];
  const dependencies = manifest.dependencies ?? {};
  const optionalDependencies = manifest.optionalDependencies ?? {};
  const peers = manifest.peerDependencies ?? {};

  if (manifest.name !== expectation.name) {
    problems.push(`package name is ${String(manifest.name)}, expected ${expectation.name}`);
  }
  if (manifest.type !== 'module') problems.push('package is not ESM-only');
  if (manifest.sideEffects !== false) problems.push('package does not declare sideEffects false');

  for (const [name, range] of entries(expectation.dependencies)) {
    if (dependencies[name] !== range) {
      problems.push(`dependency ${name} is ${String(dependencies[name])}, expected ${range}`);
    }
  }
  for (const [name, range] of entries(dependencies)) {
    const reason = forbiddenDependencyReason(name);
    if (reason !== undefined) problems.push(`${reason} ${name} is forbidden`);
    if (expectation.dependencies[name] === undefined) {
      problems.push(`unexpected runtime dependency ${name}@${range}`);
    }
  }
  for (const [name, range] of entries(optionalDependencies)) {
    const reason = forbiddenDependencyReason(name);
    if (reason !== undefined) problems.push(`${reason} ${name} is forbidden`);
    problems.push(`adapter runtime dependency ${name}@${range} may not be optional`);
  }

  for (const [name, range] of entries(expectation.peerDependencies)) {
    if (peers[name] === undefined) {
      problems.push(`undeclared framework dependency ${name}`);
    } else if (peers[name] !== range) {
      problems.push(`framework peer ${name} is ${peers[name]}, expected ${range}`);
    }
    if (dependencies[name] !== undefined || optionalDependencies[name] !== undefined) {
      problems.push(`framework dependency ${name} must remain a peer`);
    }
  }
  for (const [name, range] of entries(peers)) {
    const reason = forbiddenDependencyReason(name);
    if (reason !== undefined) problems.push(`${reason} ${name} is forbidden`);
    if (expectation.peerDependencies[name] === undefined) {
      problems.push(`unexpected framework peer ${name}@${range}`);
    }
  }

  const actualExports = Object.keys(manifest.exports ?? {}).toSorted();
  const expectedExports = [...expectation.exports].toSorted();
  if (json(actualExports) !== json(expectedExports)) {
    problems.push(`exports are ${json(actualExports)}, expected ${json(expectedExports)}`);
  }

  const actualOptionalPeers = optionalPeers(manifest);
  const expectedOptionalPeers = [...expectation.optionalPeers].toSorted();
  if (json(actualOptionalPeers) !== json(expectedOptionalPeers)) {
    problems.push(`optional peers are ${json(actualOptionalPeers)}, expected ${json(expectedOptionalPeers)}`);
  }

  return Object.freeze(problems);
}

export function assertAdapterPackageManifest(
  expectation: AdapterPackageExpectation,
  manifest: AdapterPackageManifest,
): void {
  const problems = adapterManifestProblems(expectation, manifest);
  if (problems.length === 0) return;
  throw new Error(`${expectation.name} manifest violates adapter rules:\n- ${problems.join('\n- ')}`);
}

export function adapterExportSpecifiers(expectation: AdapterPackageExpectation): readonly string[] {
  return expectation.exports.map(subpath =>
    subpath === '.' ? expectation.name : `${expectation.name}/${subpath.slice('./'.length)}`,
  );
}

export interface AdapterImportProbeResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function commandOutput(value: string | Buffer | null | undefined): string {
  return typeof value === 'string' ? value : (value?.toString() ?? '');
}

function importProbeSource(
  specifiers: readonly string[],
  requiredPeers: readonly string[],
  allowedGlobals: readonly string[],
): string {
  return `
for (const specifier of ${JSON.stringify(requiredPeers)}) {
  try {
    import.meta.resolve(specifier);
    await import(specifier);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
}
const before = new Set(Reflect.ownKeys(globalThis));
const allowed = new Set(${JSON.stringify(allowedGlobals)});
let requests = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value() {
    requests += 1;
    throw new Error('adapter import attempted network I/O');
  },
});
for (const specifier of ${JSON.stringify(specifiers)}) {
  await import(specifier);
}
const added = Reflect.ownKeys(globalThis)
  .filter(key => !before.has(key) && key !== 'fetch' && !allowed.has(String(key)))
  .map(String);
if (requests !== 0) throw new Error('adapter import executed network I/O');
if (added.length !== 0) throw new Error('adapter import registered globals: ' + added.join(', '));
`;
}

function runImportProbe(
  root: string,
  specifiers: readonly string[],
  requiredPeers: readonly string[],
  allowedGlobals: readonly string[],
  conditions: readonly string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      ...conditions.map(condition => `--conditions=${condition}`),
      `--import=${join(root, 'scripts', 'ts-specifier-hook.mjs')}`,
      '--input-type=module',
      '--eval',
      importProbeSource(specifiers, requiredPeers, allowedGlobals),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

export function probeAdapterImports(root: string, expectation: AdapterPackageExpectation): AdapterImportProbeResult {
  const specifiers = adapterExportSpecifiers(expectation);
  const requiredPeers = Object.keys(expectation.peerDependencies)
    .filter(name => !expectation.optionalPeers.includes(name))
    .toSorted();
  const allowedGlobals = expectation.allowedImportGlobals ?? [];
  if (expectation.name !== '@zmdb/next') {
    const result = runImportProbe(root, specifiers, requiredPeers, allowedGlobals);
    return {
      status: result.status ?? 1,
      stdout: commandOutput(result.stdout),
      stderr: commandOutput(result.stderr),
    };
  }

  const clientSpecifiers = specifiers.filter(specifier => specifier !== '@zmdb/next/server');
  const client = runImportProbe(root, clientSpecifiers, requiredPeers, allowedGlobals);
  const server = runImportProbe(root, ['@zmdb/next/server'], [], allowedGlobals, ['react-server']);
  const guarded = spawnSync(
    process.execPath,
    [
      `--import=${join(root, 'scripts', 'ts-specifier-hook.mjs')}`,
      '--input-type=module',
      '--eval',
      "await import('@zmdb/next/server')",
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  const guardStderr = commandOutput(guarded.stderr);
  const guardWorked =
    guarded.status !== 0 && guardStderr.includes('This module cannot be imported from a Client Component module');
  const status = client.status === 0 && server.status === 0 && guardWorked ? 0 : 1;
  return {
    status,
    stdout: [client.stdout, server.stdout, guarded.stdout].map(commandOutput).filter(Boolean).join('\n'),
    stderr: [client.stderr, server.stderr, guardWorked ? '' : `plain @zmdb/next/server guard result:\n${guardStderr}`]
      .map(commandOutput)
      .filter(Boolean)
      .join('\n'),
  };
}

export function assertAdapterImportsWithoutEffects(root: string, expectation: AdapterPackageExpectation): void {
  const result = probeAdapterImports(root, expectation);
  if (result.status === 0) return;
  throw new Error(
    `${expectation.name} import-side-effect probe failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
  );
}

export function adapterPackageCycle(expectations: readonly AdapterPackageExpectation[]): readonly string[] | null {
  const graph = new Map<string, Set<string>>();
  for (const expectation of expectations) {
    const targets = new Set(Object.keys(expectation.dependencies).filter(dependency => dependency !== '@zmdb/client'));
    graph.set(expectation.name, targets);
    for (const target of targets) {
      if (!graph.has(target)) graph.set(target, new Set());
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): readonly string[] | null => {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

function sourceFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:m?[jt]s)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function isTestFile(path: string): boolean {
  return /\.(?:spec|test|type-test)\.[cm]?[jt]s$/.test(path);
}

export function privateHarnessProductionLeaks(root: string): readonly string[] {
  const leaks: string[] = [];
  const packages = join(root, 'packages');
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = join(packages, entry.name);
    const manifestPath = join(packageDirectory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AdapterPackageManifest;
      const runtimeNames = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ];
      for (const name of runtimeNames) {
        if (PRIVATE_HARNESS_NAMES.has(name)) {
          leaks.push(`${relative(root, manifestPath)} declares private harness ${name}`);
        }
      }
    }

    const source = join(packageDirectory, 'src');
    if (!existsSync(source)) continue;
    for (const path of sourceFiles(source)) {
      if (isTestFile(path)) continue;
      const contents = readFileSync(path, 'utf8');
      if (
        contents.includes('@zmdb-fixture/client-adapters') ||
        contents.includes('@zmdb/client-adapters') ||
        contents.includes('fixtures/client-adapters')
      ) {
        leaks.push(`${relative(root, path)} imports the private adapter harness`);
      }
    }
  }
  return Object.freeze(leaks.toSorted());
}
