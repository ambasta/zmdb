import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

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
  const importProbePeers = expectation.importProbePeers ?? requiredPeers;
  const allowedGlobals = expectation.allowedImportGlobals ?? [];
  if (expectation.name !== '@zmdb/next') {
    const result = runImportProbe(root, specifiers, importProbePeers, allowedGlobals);
    return {
      status: result.status ?? 1,
      stdout: commandOutput(result.stdout),
      stderr: commandOutput(result.stderr),
    };
  }

  const clientSpecifiers = specifiers.filter(specifier => specifier !== '@zmdb/next/server');
  const client = runImportProbe(root, clientSpecifiers, importProbePeers, allowedGlobals);
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

const GENERATED_CLIENT_IMPLEMENTATION_TOKENS = [
  'CLIENT_RUNTIME_ABI',
  'ClientOperationResponse',
  'DecodeResult<',
  'GeneratedOperation<',
  'ResponseValidationError',
  'UnexpectedStatusError',
  '.body.json(',
  '.unexpectedStatus(',
  'operationId:',
  'runtime.call(',
] as const;

const BASE_ADAPTER_TRANSPORT_TOKENS = [
  'createFetchTransport',
  'encodeURIComponent(',
  'globalThis.fetch(',
  'new URL(',
] as const;

function existingFiles(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return statSync(path).isDirectory() ? sourceFiles(path) : [path];
}

function qualificationText(root: string, paths: readonly string[]): string {
  return paths
    .flatMap(path => existingFiles(join(root, path)))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
}

export function adapterClientImplementationProblems(
  root: string,
  expectation: AdapterPackageExpectation,
): readonly string[] {
  const problems: string[] = [];
  const source = join(root, 'packages', expectation.directory, 'src');
  const tokens =
    expectation.qualification.kind === 'meta-framework'
      ? GENERATED_CLIENT_IMPLEMENTATION_TOKENS
      : [...GENERATED_CLIENT_IMPLEMENTATION_TOKENS, ...BASE_ADAPTER_TRANSPORT_TOKENS];

  for (const path of sourceFiles(source)) {
    if (isTestFile(path)) continue;
    const contents = readFileSync(path, 'utf8');
    for (const token of tokens) {
      if (contents.includes(token)) {
        problems.push(`${relative(root, path)} contains generated-client implementation token ${token}`);
      }
    }
  }

  return Object.freeze(problems.toSorted());
}

function importSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:export|import)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return Object.freeze(specifiers);
}

function relativeImportTarget(path: string, specifier: string): string | undefined {
  const target = resolve(dirname(path), specifier);
  const extension = extname(target);
  const candidates =
    extension === '.js'
      ? [`${target.slice(0, -extension.length)}.ts`, `${target.slice(0, -extension.length)}.tsx`]
      : extension === '.mjs'
        ? [`${target.slice(0, -extension.length)}.mts`]
        : extension.length === 0
          ? [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]
          : [target];
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
}

function browserSourceGraph(entry: string): readonly string[] {
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = relativeImportTarget(path, specifier);
      if (target !== undefined) visit(target);
    }
  };
  visit(entry);
  return Object.freeze([...visited].toSorted());
}

export function adapterBrowserBoundaryProblems(
  root: string,
  expectation: AdapterPackageExpectation,
): readonly string[] {
  const boundary = expectation.qualification.browserBoundary;
  if (boundary === undefined) return [];

  const problems: string[] = [];
  const clientEntry = join(root, boundary.clientEntry);
  const serverEntry = join(root, boundary.serverEntry);
  const verifier = join(root, boundary.packedVerifier);
  for (const [label, path] of [
    ['client entry', clientEntry],
    ['server entry', serverEntry],
    ['packed verifier', verifier],
  ] as const) {
    if (!existsSync(path)) problems.push(`${label} is missing at ${relative(root, path)}`);
  }
  if (problems.length > 0) return Object.freeze(problems);

  const graph = browserSourceGraph(clientEntry);
  if (graph.includes(serverEntry)) {
    problems.push(`${boundary.clientEntry} reaches ${boundary.serverEntry}`);
  }
  for (const path of graph) {
    const source = readFileSync(path, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('node:')) {
        problems.push(`${relative(root, path)} imports browser-incompatible ${specifier}`);
      }
    }
    for (const token of boundary.forbiddenBrowserTokens) {
      if (source.includes(token)) {
        problems.push(`${relative(root, path)} reaches server token ${token}`);
      }
    }
  }

  const verifierSource = readFileSync(verifier, 'utf8');
  for (const token of boundary.forbiddenBrowserTokens) {
    if (!verifierSource.includes(token)) {
      problems.push(`${boundary.packedVerifier} does not inspect browser output for ${token}`);
    }
  }
  const packedTestSource = readFileSync(join(root, expectation.qualification.packedTest), 'utf8');
  const verifierName = boundary.packedVerifier.split('/').at(-1);
  if (verifierName === undefined || !packedTestSource.includes(verifierName)) {
    problems.push(`${expectation.qualification.packedTest} does not execute ${boundary.packedVerifier}`);
  }

  return Object.freeze(problems.toSorted());
}

export function adapterQualificationProblems(root: string, expectation: AdapterPackageExpectation): readonly string[] {
  const problems: string[] = [];
  const qualification = expectation.qualification;
  const requiredPaths = [
    qualification.packedTest,
    qualification.fixture,
    qualification.generatedClient,
    ...(qualification.commonConformance === undefined ? [] : [qualification.commonConformance]),
    ...qualification.sourceEvidence.map(evidence => evidence.path),
  ];
  for (const path of requiredPaths) {
    if (!existsSync(join(root, path))) problems.push(`qualification evidence is missing at ${path}`);
  }
  if (problems.length > 0) return Object.freeze(problems.toSorted());

  const generatedClient = readFileSync(join(root, qualification.generatedClient), 'utf8');
  for (const copy of qualification.generatedClientCopies ?? []) {
    const path = join(root, copy);
    if (!existsSync(path)) {
      problems.push(`generated-client copy is missing at ${copy}`);
    } else if (readFileSync(path, 'utf8') !== generatedClient) {
      problems.push(`${copy} differs from ${qualification.generatedClient}`);
    }
  }

  const packedEvidence = qualificationText(root, [
    qualification.packedTest,
    qualification.fixture,
    ...(qualification.commonConformance === undefined ? [] : [qualification.commonConformance]),
  ]);
  if (!packedEvidence.includes('runPackedProject')) {
    problems.push(`${expectation.name} has no packed tarball consumer`);
  }
  if (!packedEvidence.includes('api.generated.ts')) {
    problems.push(`${expectation.name} packed evidence does not install the shared generated fixture client`);
  }
  if (qualification.kind === 'base') {
    for (const marker of ['assertPendingAndSuccess', 'assertIndependentMutations', 'assertSsrCredentialIsolation']) {
      if (!packedEvidence.includes(marker)) {
        problems.push(`${expectation.name} packed evidence omits common conformance marker ${marker}`);
      }
    }
  }

  for (const evidence of qualification.sourceEvidence) {
    const source = readFileSync(join(root, evidence.path), 'utf8');
    for (const marker of evidence.markers) {
      if (!source.includes(marker)) {
        problems.push(`${evidence.path} does not demonstrate ${expectation.name} ownership marker ${marker}`);
      }
    }
  }

  return Object.freeze(problems.toSorted());
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
