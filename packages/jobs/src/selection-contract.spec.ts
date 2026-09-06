import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publishManifest, publishTrain } from '../../../.github/scripts/lib/publish-manifest.mjs';
import { withPackedBuildLock } from '../../../fixtures/client-adapters/src/packed-project.js';
import {
  Cron as JobsCron,
  Interval as JobsInterval,
  createScheduler as createJobsScheduler,
  schedulesOf as jobsSchedulesOf,
} from './index.js';
import {
  Cron as ScheduleCron,
  Interval as ScheduleInterval,
  createScheduler as createScheduleScheduler,
  schedulesOf as scheduleDefinitionsOf,
} from './schedule/index.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const PACKAGES = join(ROOT, 'packages');
const FIXTURES = join(ROOT, 'fixtures', 'consumer-jobs-selection');
const RELEASE_VERSION = (await publishTrain(ROOT)).version;
const PACKED_TIMEOUT_MS = 600_000;
const COMMAND_TIMEOUT_MS = 120_000;

const DEFAULT_CLOSURE = [
  '@zmdb/ai',
  '@zmdb/aot-validator',
  '@zmdb/app',
  '@zmdb/compiler',
  '@zmdb/migrations',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/schema-core',
  '@zmdb/web',
  'zmdb',
] as const;
const PORTABLE_CLOSURE = [
  '@zmdb/ai',
  '@zmdb/aot-validator',
  '@zmdb/app',
  '@zmdb/jobs',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/schema-core',
] as const;
const SQLITE_CLOSURE = [
  '@zmdb/ai',
  '@zmdb/aot-validator',
  '@zmdb/app',
  '@zmdb/jobs',
  '@zmdb/jobs-sqlite',
  '@zmdb/migrations',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/schema-core',
  '@zmdb/sqlite',
] as const;
const POSTGRES_CLOSURE = [
  '@zmdb/ai',
  '@zmdb/aot-validator',
  '@zmdb/app',
  '@zmdb/jobs',
  '@zmdb/jobs-postgres',
  '@zmdb/migrations',
  '@zmdb/postgres',
  '@zmdb/query-compiler',
  '@zmdb/repository',
  '@zmdb/schema-core',
] as const;
const JOBS_PACKAGES = ['@zmdb/jobs', '@zmdb/jobs-postgres', '@zmdb/jobs-sqlite'] as const;
const DEFAULT_IDENTITY_SOURCE = `
import { assert as directAssert } from '@zmdb/aot-validator/utilities';
import { BaseRepository as DirectBaseRepository } from '@zmdb/repository';
import { createApp as directCreateApp } from '@zmdb/web';
import { assert } from 'zmdb';
import { BaseRepository } from 'zmdb/orm';
import { createApp } from 'zmdb/web';

if (assert !== directAssert || BaseRepository !== DirectBaseRepository || createApp !== directCreateApp) {
  throw new Error('packed default facade duplicated a canonical runtime value');
}

process.stdout.write(JSON.stringify({ identity: true }));
`;

interface PackageManifest extends Readonly<Record<string, unknown>> {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
  readonly exports?: Readonly<Record<string, unknown>>;
}

interface WorkspacePackage {
  readonly directory: string;
  readonly manifest: PackageManifest;
}

interface PackedTarball {
  readonly name: string;
  readonly path: string;
  readonly sourceDirectory: string;
}

interface InstalledPackage {
  readonly directory: string;
  readonly manifest: PackageManifest;
}

interface InstalledGraph {
  readonly root: string;
  readonly packages: ReadonlyMap<string, InstalledPackage>;
  readonly closure: readonly string[];
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

interface Consumer {
  readonly directory: string;
  readonly root: string;
  readonly graph: InstalledGraph;
}

interface PackedMatrix {
  readonly directory: string;
  readonly workspace: ReadonlyMap<string, WorkspacePackage>;
  readonly tarballs: ReadonlyMap<string, PackedTarball>;
  readonly defaultConsumer: Consumer;
  readonly portableConsumer: Consumer;
  readonly postgresConsumer: Consumer;
  readonly sqliteConsumer: Consumer | undefined;
  cleanup(): void;
}

function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, [...arguments_], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 20 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function commandOutput(result: SpawnSyncReturns<string>): string {
  return [result.stdout, result.stderr]
    .filter(value => value !== null && value !== '')
    .join('\n')
    .trim();
}

function requireSuccess(label: string, result: SpawnSyncReturns<string>): void {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${String(result.status)}\n${commandOutput(result)}`);
  }
}

function readManifest(path: string): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed) || typeof parsed.name !== 'string') {
    throw new Error(`${path} has no package name`);
  }
  return parsed as PackageManifest;
}

function workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(PACKAGES, entry.name);
    const path = join(directory, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = readManifest(path);
    packages.set(manifest.name, { directory, manifest });
  }
  return packages;
}

function workspaceClosure(
  packages: ReadonlyMap<string, WorkspacePackage>,
  roots: readonly string[],
): readonly string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`SELECTION_PROVIDER_MISSING: workspace package ${name} is absent`);
    visited.add(name);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {}).toSorted()) {
      if (packages.has(dependency)) visit(dependency);
    }
    order.push(name);
  };

  for (const root of roots) visit(root);
  return order;
}

function copyPackage(sourceDirectory: string, destination: string): void {
  cpSync(sourceDirectory, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function packFilename(output: string): string {
  const report: unknown = JSON.parse(output);
  const row =
    Array.isArray(report) && report.length > 0
      ? report[0]
      : typeof report === 'object' && report !== null
        ? Object.values(report)[0]
        : undefined;
  if (typeof row !== 'object' || row === null || !('filename' in row) || typeof row.filename !== 'string') {
    throw new Error(`npm pack returned no filename: ${output}`);
  }
  return row.filename;
}

function buildPackages(packages: ReadonlyMap<string, WorkspacePackage>, names: readonly string[]): void {
  for (const name of names) {
    const built = run('yarn', ['workspace', name, 'build'], ROOT);
    requireSuccess(`${name} focused build`, built);
  }
}

function packPackages(
  packages: ReadonlyMap<string, WorkspacePackage>,
  names: readonly string[],
  directory: string,
): ReadonlyMap<string, PackedTarball> {
  const stageRoot = join(directory, 'stage');
  const archiveRoot = join(directory, 'tarballs');
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });
  const tarballs = new Map<string, PackedTarball>();

  for (const [index, name] of names.entries()) {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`cannot pack absent workspace package ${name}`);
    const stage = join(stageRoot, String(index));
    copyPackage(pkg.directory, stage);
    const published = publishManifest(pkg.manifest, RELEASE_VERSION) as Readonly<Record<string, unknown>>;
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
    const packed = run('npm', ['pack', '--json', '--pack-destination', archiveRoot], stage, {
      COREPACK_ENABLE_PROJECT_SPEC: '0',
    });
    requireSuccess(`${name} npm pack`, packed);
    tarballs.set(name, {
      name,
      path: join(archiveRoot, packFilename(packed.stdout)),
      sourceDirectory: pkg.directory,
    });
  }
  return tarballs;
}

function writeConsumerFile(application: string, path: string, contents: string): void {
  const destination = resolve(application, path);
  const rel = relative(application, destination);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`consumer path escapes fixture: ${path}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function compilerOptions(rootDir = 'src'): Readonly<Record<string, unknown>> {
  return {
    allowImportingTsExtensions: false,
    exactOptionalPropertyTypes: true,
    lib: ['ESNext', 'DOM', 'DOM.Iterable'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    noEmitOnError: true,
    noUncheckedIndexedAccess: true,
    outDir: 'dist',
    rootDir,
    skipLibCheck: false,
    strict: true,
    target: 'ES2022',
    types: ['node'],
    verbatimModuleSyntax: true,
  };
}

function scanInstalled(nodeModules: string): ReadonlyMap<string, InstalledPackage> {
  const packages = new Map<string, InstalledPackage>();
  const visited = new Set<string>();

  const scan = (directory: string): void => {
    if (!existsSync(directory) || visited.has(directory)) return;
    visited.add(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(path, { withFileTypes: true })) {
          if (!scoped.isDirectory()) continue;
          const packageDirectory = join(path, scoped.name);
          register(packageDirectory);
        }
      } else {
        register(path);
      }
    }
  };

  const register = (directory: string): void => {
    const path = join(directory, 'package.json');
    if (!existsSync(path)) return;
    const manifest = readManifest(path);
    const previous = packages.get(manifest.name);
    if (previous !== undefined && previous.manifest.version !== manifest.version) {
      throw new Error(
        `installed package ${manifest.name} has versions ${String(previous.manifest.version)} and ${String(
          manifest.version,
        )}`,
      );
    }
    packages.set(manifest.name, { directory, manifest });
    scan(join(directory, 'node_modules'));
  };

  scan(nodeModules);
  return packages;
}

function installedGraph(root: string, packages: ReadonlyMap<string, InstalledPackage>): InstalledGraph {
  const paths = new Map<string, readonly string[]>([[root, [root]]]);
  const queue = [root];
  const closure: string[] = [];

  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || closure.includes(name)) continue;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`installed graph is missing ${name}`);
    closure.push(name);
    const dependencies = {
      ...pkg.manifest.dependencies,
      ...pkg.manifest.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies).toSorted()) {
      if (!packages.has(dependency) || paths.has(dependency)) continue;
      paths.set(dependency, [...(paths.get(name) ?? [name]), dependency]);
      queue.push(dependency);
    }
  }

  return {
    root,
    packages,
    closure: closure.toSorted(),
    paths,
  };
}

function assertPackedInstall(consumer: string, tarballs: ReadonlyMap<string, PackedTarball>, names: readonly string[]) {
  for (const name of names) {
    const tarball = tarballs.get(name);
    if (tarball === undefined) throw new Error(`no tarball for ${name}`);
    const installed = join(consumer, 'node_modules', ...name.split('/'));
    if (!existsSync(installed)) throw new Error(`${name} was not installed`);
    if (lstatSync(installed).isSymbolicLink()) throw new Error(`${name} installed through a symlink`);
    const installedReal = realpathSync(installed);
    const consumerReal = realpathSync(consumer);
    if (!installedReal.startsWith(`${consumerReal}${sep}`) || installedReal === realpathSync(tarball.sourceDirectory)) {
      throw new Error(`${name} resolved to workspace source ${installedReal}`);
    }
    if (readFileSync(join(installed, 'package.json'), 'utf8').includes('workspace:')) {
      throw new Error(`${name} packed manifest retained a workspace protocol`);
    }
  }
}

function installConsumer(options: {
  readonly label: string;
  readonly root: string;
  readonly workspace: ReadonlyMap<string, WorkspacePackage>;
  readonly tarballs: ReadonlyMap<string, PackedTarball>;
  readonly directory: string;
  readonly selectedOfficial?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
  readonly configs: Readonly<Record<string, readonly string[]>>;
}): Consumer {
  const selectedOfficial = [options.root, ...(options.selectedOfficial ?? [])];
  const closure = workspaceClosure(options.workspace, selectedOfficial);
  const application = join(options.directory, 'consumers', options.label);
  mkdirSync(application, { recursive: true });
  const selectedDependencies = Object.fromEntries(
    selectedOfficial.map(name => {
      const tarball = options.tarballs.get(name);
      if (tarball === undefined) throw new Error(`SELECTION_PROVIDER_MISSING: no tarball for ${name}`);
      return [name, `file:${tarball.path}`];
    }),
  );
  const dependencies = { ...selectedDependencies, ...options.dependencies };
  writeFileSync(
    join(application, 'package.json'),
    `${JSON.stringify(
      {
        name: `@zmdb-fixture/${options.label}`,
        private: true,
        type: 'module',
        dependencies,
        devDependencies: options.devDependencies,
      },
      null,
      2,
    )}\n`,
  );

  for (const [name, contents] of Object.entries(options.sources)) {
    writeConsumerFile(application, `src/${name}`, contents);
  }
  for (const [name, include] of Object.entries(options.configs)) {
    writeConsumerFile(
      application,
      name,
      `${JSON.stringify({ compilerOptions: compilerOptions(), include }, null, 2)}\n`,
    );
  }

  const localTarballs = closure.map(name => {
    const tarball = options.tarballs.get(name);
    if (tarball === undefined) throw new Error(`no tarball for ${name}`);
    return tarball.path;
  });
  const installed = run(
    'npm',
    [
      'install',
      '--no-save',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--loglevel=error',
      ...localTarballs,
    ],
    application,
    {
      COREPACK_ENABLE_PROJECT_SPEC: '0',
      npm_config_cache: join(options.directory, 'npm-cache'),
      npm_config_logs_dir: join(options.directory, 'npm-logs'),
    },
  );
  requireSuccess(`${options.label} tarball install`, installed);
  assertPackedInstall(application, options.tarballs, closure);

  const consumerManifest = readManifest(join(application, 'package.json'));
  const installedSelections = Object.keys(consumerManifest.dependencies ?? {}).filter(
    name => name === 'zmdb' || name.startsWith('@zmdb/'),
  );
  if (JSON.stringify(installedSelections) !== JSON.stringify(selectedOfficial)) {
    throw new Error(
      `consumer selected official packages ${JSON.stringify(installedSelections)}, expected ${JSON.stringify(
        selectedOfficial,
      )}`,
    );
  }

  const packages = scanInstalled(join(application, 'node_modules'));
  return {
    directory: application,
    root: options.root,
    graph: installedGraph(options.root, packages),
  };
}

function source(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function prepareMatrix(): PackedMatrix {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-selection-754-'));
  try {
    const workspace = workspacePackages();
    const roots = ['zmdb', '@zmdb/jobs', '@zmdb/jobs-postgres'];
    if (workspace.has('@zmdb/jobs-sqlite')) roots.push('@zmdb/jobs-sqlite');
    const names = workspaceClosure(workspace, roots);
    const tarballs = withPackedBuildLock(ROOT, () => {
      buildPackages(workspace, names);
      return packPackages(workspace, names, directory);
    });
    const commonDevDependencies = {
      '@types/node': '26.4.1',
      typescript: '7.0.2',
    };
    const defaultConsumer = installConsumer({
      label: 'selection-default',
      root: 'zmdb',
      workspace,
      tarballs,
      directory,
      selectedOfficial: ['@zmdb/sqlite'],
      devDependencies: commonDevDependencies,
      sources: {
        'default.ts': source('default.ts'),
        'identity.ts': DEFAULT_IDENTITY_SOURCE,
      },
      configs: { 'tsconfig.default.json': ['src/default.ts', 'src/identity.ts'] },
    });
    const portableConsumer = installConsumer({
      label: 'selection-portable',
      root: '@zmdb/jobs',
      workspace,
      tarballs,
      directory,
      devDependencies: commonDevDependencies,
      sources: {
        'missing-provider.ts': source('missing-provider.ts'),
        'portable.ts': source('portable.ts'),
      },
      configs: {
        'tsconfig.missing-provider.json': ['src/missing-provider.ts'],
        'tsconfig.portable.json': ['src/portable.ts'],
      },
    });
    const postgresConsumer = installConsumer({
      label: 'selection-postgres',
      root: '@zmdb/jobs-postgres',
      workspace,
      tarballs,
      directory,
      dependencies: { pg: '8.23.0' },
      devDependencies: {
        ...commonDevDependencies,
        '@types/pg': '8.23.1',
      },
      sources: { 'postgres.ts': source('postgres.ts') },
      configs: { 'tsconfig.postgres.json': ['src/postgres.ts'] },
    });
    const sqliteConsumer = workspace.has('@zmdb/jobs-sqlite')
      ? installConsumer({
          label: 'selection-sqlite',
          root: '@zmdb/jobs-sqlite',
          workspace,
          tarballs,
          directory,
          devDependencies: commonDevDependencies,
          sources: { 'sqlite.ts': source('sqlite.ts') },
          configs: { 'tsconfig.sqlite.json': ['src/sqlite.ts'] },
        })
      : undefined;
    let cleaned = false;
    return {
      directory,
      workspace,
      tarballs,
      defaultConsumer,
      portableConsumer,
      postgresConsumer,
      sqliteConsumer,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function official(name: string): boolean {
  return name === 'zmdb' || name.startsWith('@zmdb/');
}

function directOfficial(manifest: PackageManifest): readonly string[] {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  })
    .filter(official)
    .toSorted();
}

function formatPath(graph: InstalledGraph, name: string): string {
  return (graph.paths.get(name) ?? [graph.root, name]).join(' -> ');
}

function equalNames(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].toSorted()) === JSON.stringify([...expected].toSorted());
}

function selectionDiagnostics(
  graph: InstalledGraph,
  selected: Readonly<Record<string, string>> = {},
): readonly string[] {
  const problems: string[] = [];
  const rootPackage = graph.packages.get(graph.root);
  if (rootPackage === undefined) return [`SELECTION_BUDGET_DRIFT: installed root ${graph.root} is absent`];
  const closure = graph.closure.filter(official).toSorted();
  const direct = directOfficial(rootPackage.manifest);

  if (graph.root === 'zmdb') {
    for (const name of JOBS_PACKAGES) {
      if (closure.includes(name)) problems.push(`SELECTION_DEFAULT_LEAK: ${formatPath(graph, name)}`);
    }
    if (Object.keys(rootPackage.manifest.exports ?? {}).some(name => name === './jobs' || name.startsWith('./jobs/'))) {
      problems.push('SELECTION_FACADE_FORBIDDEN: zmdb exports a jobs runtime facade');
    }
    if (!equalNames(closure, DEFAULT_CLOSURE)) {
      problems.push(
        `SELECTION_BUDGET_DRIFT: zmdb official closure ${JSON.stringify(closure)}, expected ${JSON.stringify(
          DEFAULT_CLOSURE,
        )}`,
      );
    }
  }

  if (graph.root === '@zmdb/jobs') {
    for (const name of [
      '@zmdb/jobs-postgres',
      '@zmdb/jobs-sqlite',
      '@zmdb/migrations',
      '@zmdb/postgres',
      '@zmdb/query-compiler',
      '@zmdb/repository',
      '@zmdb/sqlite',
      'pg',
    ]) {
      if (graph.closure.includes(name)) {
        problems.push(`SELECTION_PROVIDER_LEAK: ${formatPath(graph, name)}`);
      }
    }
    const externalDirect = Object.keys({
      ...rootPackage.manifest.dependencies,
      ...rootPackage.manifest.optionalDependencies,
    }).filter(name => !official(name));
    if (externalDirect.length > 0) {
      problems.push(`SELECTION_PROVIDER_LEAK: @zmdb/jobs -> ${externalDirect.toSorted().join(', ')}`);
    }
    if (
      !equalNames(direct, ['@zmdb/app']) ||
      !equalNames(closure, PORTABLE_CLOSURE) ||
      Object.keys(rootPackage.manifest.optionalDependencies ?? {}).length > 0 ||
      Object.keys(rootPackage.manifest.peerDependencies ?? {}).length > 0
    ) {
      problems.push(
        `SELECTION_BUDGET_DRIFT: @zmdb/jobs direct=${JSON.stringify(direct)} closure=${JSON.stringify(closure)}`,
      );
    }
  }

  if (graph.root === '@zmdb/jobs-sqlite') {
    for (const name of ['@zmdb/jobs-postgres', '@zmdb/postgres', 'pg']) {
      if (graph.closure.includes(name)) {
        problems.push(`SELECTION_PROVIDER_MISMATCH: ${formatPath(graph, name)}`);
      }
    }
    if (!equalNames(direct, ['@zmdb/jobs', '@zmdb/sqlite']) || !equalNames(closure, SQLITE_CLOSURE)) {
      problems.push(
        `SELECTION_BUDGET_DRIFT: @zmdb/jobs-sqlite direct=${JSON.stringify(direct)} closure=${JSON.stringify(closure)}`,
      );
    }
  }

  if (graph.root === '@zmdb/jobs-postgres') {
    for (const name of ['@zmdb/jobs-sqlite', '@zmdb/sqlite']) {
      if (graph.closure.includes(name)) {
        problems.push(`SELECTION_PROVIDER_MISMATCH: ${formatPath(graph, name)}`);
      }
    }
    if (!equalNames(direct, ['@zmdb/jobs', '@zmdb/postgres']) || !equalNames(closure, POSTGRES_CLOSURE)) {
      problems.push(
        `SELECTION_BUDGET_DRIFT: @zmdb/jobs-postgres direct=${JSON.stringify(direct)} closure=${JSON.stringify(
          closure,
        )}`,
      );
    }
    const peer = rootPackage.manifest.peerDependencies?.['pg'];
    if (peer !== '^8.23.0' || selected['pg'] !== '8.23.0') {
      problems.push(
        `SELECTION_PEER_MISSING: @zmdb/jobs-postgres requires pg@^8.23.0; selected ${selected['pg'] ?? 'none'}`,
      );
    }
  }

  return problems.toSorted();
}

function cloneInstalledGraph(graph: InstalledGraph): {
  readonly packages: Map<string, InstalledPackage>;
  graph(): InstalledGraph;
} {
  const packages = new Map(
    [...graph.packages].map(([name, pkg]) => [
      name,
      {
        directory: pkg.directory,
        manifest: JSON.parse(JSON.stringify(pkg.manifest)) as PackageManifest,
      },
    ]),
  );
  return {
    packages,
    graph: () => installedGraph(graph.root, packages),
  };
}

function replaceManifest(
  packages: Map<string, InstalledPackage>,
  name: string,
  update: (manifest: PackageManifest) => PackageManifest,
): void {
  const pkg = packages.get(name);
  if (pkg === undefined) throw new Error(`mutation package ${name} is absent`);
  packages.set(name, { ...pkg, manifest: update(pkg.manifest) });
}

function importSpecifiers(sourceText: string): readonly string[] {
  const names = new Set<string>();
  for (const match of sourceText.matchAll(/(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  for (const match of sourceText.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].toSorted();
}

function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return undefined;
  if (!specifier.startsWith('@')) return specifier.split('/')[0];
  const [scope, name] = specifier.split('/');
  return scope !== undefined && name !== undefined ? `${scope}/${name}` : specifier;
}

function providerSourceProblems(packageName: string, sourceText: string, manifest: PackageManifest): readonly string[] {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const problems = importSpecifiers(sourceText)
    .map(packageNameOf)
    .filter((name): name is string => name !== undefined && !declared.has(name))
    .map(name => `SELECTION_PROVIDER_MISMATCH: ${packageName} imports undeclared ${name}`);
  if (/\.\s*(?:end|release)\s*\(/.test(sourceText)) {
    problems.push(`SELECTION_PROVIDER_MISMATCH: ${packageName} closes or releases a caller-owned client`);
  }
  return problems.toSorted();
}

function runTypecheck(consumer: Consumer, config: string): SpawnSyncReturns<string> {
  return run(
    process.execPath,
    [join(consumer.directory, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config],
    consumer.directory,
  );
}

function runRuntime(consumer: Consumer, file: string): SpawnSyncReturns<string> {
  return run(process.execPath, [file], consumer.directory);
}

function withTemporaryDirectory<Value>(runInDirectory: (directory: string) => Value): Value {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-selection-cleanup-'));
  try {
    return runInDirectory(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

let matrix: PackedMatrix;

beforeAll(() => {
  matrix = prepareMatrix();
}, PACKED_TIMEOUT_MS);

afterAll(() => {
  matrix.cleanup();
});

describe('default dependency graph and opt-in identity boundaries (#754)', () => {
  it('keeps the packed product graph free of database and jobs edges when SQLite is selected explicitly', () => {
    expect(matrix.defaultConsumer.graph.closure.filter(official).toSorted()).toEqual(DEFAULT_CLOSURE);
    expect(selectionDiagnostics(matrix.defaultConsumer.graph)).toEqual([]);
    for (const name of [...JOBS_PACKAGES, 'pg']) {
      expect(matrix.defaultConsumer.graph.closure, name).not.toContain(name);
    }
  });

  it(
    'runs validation, ORM, application, and HTTP together from the packed default product',
    () => {
      const typecheck = runTypecheck(matrix.defaultConsumer, 'tsconfig.default.json');
      requireSuccess('packed default typecheck', typecheck);
      const runtime = runRuntime(matrix.defaultConsumer, 'dist/default.js');
      requireSuccess('packed default runtime', runtime);
      expect(JSON.parse(runtime.stdout)).toEqual({
        rows: [{ id: 1, name: 'packed default' }],
        status: 200,
        validation: 'packed default',
      });
      const identity = runRuntime(matrix.defaultConsumer, 'dist/identity.js');
      requireSuccess('packed default identity', identity);
      expect(JSON.parse(identity.stdout)).toEqual({ identity: true });
    },
    COMMAND_TIMEOUT_MS,
  );

  // Current measured closure:
  // @zmdb/jobs -> @zmdb/query-compiler, @zmdb/repository, @zmdb/sqlite
  // and @zmdb/sqlite -> @zmdb/migrations.
  it.fails('loads portable jobs without SQLite, PostgreSQL, pg, or a hidden database package', () => {
    expect(selectionDiagnostics(matrix.portableConsumer.graph)).toEqual([]);
    expect(matrix.portableConsumer.graph.closure.filter(official).toSorted()).toEqual(PORTABLE_CLOSURE);
  });

  it(
    'requires an explicit JobStore and LeaseStore instead of resolving a provider fallback',
    () => {
      const portableTypecheck = runTypecheck(matrix.portableConsumer, 'tsconfig.portable.json');
      requireSuccess('packed portable jobs typecheck', portableTypecheck);
      const runtime = runRuntime(matrix.portableConsumer, 'dist/portable.js');
      requireSuccess('packed portable jobs runtime', runtime);
      expect(JSON.parse(runtime.stdout)).toMatchObject({
        lifecycle: ['start:worker', 'start:scheduler', 'stop:scheduler', 'stop:worker'],
        missingLease: expect.stringContaining('once-per-cluster schedules require leases'),
      });

      const missingProvider = runTypecheck(matrix.portableConsumer, 'tsconfig.missing-provider.json');
      expect(missingProvider.status).not.toBe(0);
      expect(commandOutput(missingProvider)).toContain("Property 'store' is missing");
      expect(commandOutput(missingProvider)).not.toContain('Cannot find module');
    },
    COMMAND_TIMEOUT_MS,
  );

  // Current measured failure: packages/jobs-sqlite has only SPEC.md; no
  // package.json, public entry, migrations, or runtime provider exists.
  it.fails(
    'runs enqueue, claim, retry, dead-letter, lease, and bounded shutdown through the packed SQLite provider',
    () => {
      expect(
        matrix.sqliteConsumer,
        'SELECTION_PROVIDER_MISSING: @zmdb/jobs-sqlite has no packed provider',
      ).toBeDefined();
      const consumer = matrix.sqliteConsumer;
      if (consumer === undefined) throw new Error('SELECTION_PROVIDER_MISSING: @zmdb/jobs-sqlite');
      expect(selectionDiagnostics(consumer.graph)).toEqual([]);
      expect(consumer.graph.closure.filter(official).toSorted()).toEqual(SQLITE_CLOSURE);
      const typecheck = runTypecheck(consumer, 'tsconfig.sqlite.json');
      requireSuccess('packed SQLite jobs typecheck', typecheck);
      const runtime = runRuntime(consumer, 'dist/sqlite.js');
      requireSuccess('packed SQLite jobs runtime', runtime);
      expect(JSON.parse(runtime.stdout)).toMatchObject({
        dead: 1,
        delivered: [1],
        migrations: [
          [20260906000100, 'jobs_queue'],
          [20260906000200, 'jobs_schedule_lease'],
        ],
        ownedClosed: true,
      });
    },
    COMMAND_TIMEOUT_MS,
  );

  // Current measured failure: the packed module exports createPgJobStore only;
  // pgJobEnqueuer, migrations, LeaseStore and close() are absent, and portable
  // jobs still pulls the SQLite implementation into this closure.
  it.fails(
    'loads the packed PostgreSQL provider with exact pg peer and caller-owned resources',
    () => {
      const problems = [...selectionDiagnostics(matrix.postgresConsumer.graph, { pg: '8.23.0' })];
      const observedClosure = matrix.postgresConsumer.graph.closure.filter(official).toSorted();
      if (!equalNames(observedClosure, POSTGRES_CLOSURE)) {
        problems.push(
          `SELECTION_BUDGET_DRIFT: packed PostgreSQL closure ${JSON.stringify(observedClosure)}, expected ${JSON.stringify(
            POSTGRES_CLOSURE,
          )}`,
        );
      }
      const typecheck = runTypecheck(matrix.postgresConsumer, 'tsconfig.postgres.json');
      if (typecheck.status !== 0) {
        problems.push(`PACKED_PROVIDER_TYPES: ${commandOutput(typecheck)}`);
      } else {
        const runtime = runRuntime(matrix.postgresConsumer, 'dist/postgres.js');
        if (runtime.status !== 0) {
          problems.push(`PACKED_PROVIDER_RUNTIME: ${commandOutput(runtime)}`);
        } else {
          expect(JSON.parse(runtime.stdout)).toEqual({
            enqueuer: 'function',
            migrations: [
              [20260906000100, 'jobs_queue'],
              [20260906000200, 'jobs_schedule_lease'],
            ],
            pg: '8.23.0',
            resourceCalls: [],
          });
        }
      }
      expect(problems).toEqual([]);
    },
    COMMAND_TIMEOUT_MS,
  );

  it('preserves public value identity without a duplicate jobs facade implementation', () => {
    expect(JobsCron).toBe(ScheduleCron);
    expect(JobsInterval).toBe(ScheduleInterval);
    expect(createJobsScheduler).toBe(createScheduleScheduler);
    expect(jobsSchedulesOf).toBe(scheduleDefinitionsOf);

    const rootSource = readFileSync(join(ROOT, 'packages', 'jobs', 'src', 'index.ts'), 'utf8');
    for (const name of ['Cron', 'Interval', 'createScheduler', 'schedulesOf']) {
      expect(rootSource).not.toMatch(new RegExp(`(?:function|class|const)\\s+${name}\\b`));
    }
    const postgresSource = readFileSync(join(ROOT, 'packages', 'jobs-postgres', 'src', 'index.ts'), 'utf8');
    const postgresManifest = matrix.workspace.get('@zmdb/jobs-postgres')?.manifest;
    if (postgresManifest === undefined) throw new Error('@zmdb/jobs-postgres manifest is absent');
    expect(providerSourceProblems('@zmdb/jobs-postgres', postgresSource, postgresManifest)).toEqual([]);
  });

  it('rejects an accidental zmdb to jobs edge with SELECTION_DEFAULT_LEAK', () => {
    const mutation = cloneInstalledGraph(matrix.defaultConsumer.graph);
    const installedJobs = matrix.portableConsumer.graph.packages.get('@zmdb/jobs');
    if (installedJobs === undefined) throw new Error('packed portable consumer omitted @zmdb/jobs');
    mutation.packages.set('@zmdb/jobs', installedJobs);
    replaceManifest(mutation.packages, 'zmdb', manifest => ({
      ...manifest,
      dependencies: { ...manifest.dependencies, '@zmdb/jobs': RELEASE_VERSION },
    }));
    expect(selectionDiagnostics(mutation.graph())).toContain('SELECTION_DEFAULT_LEAK: zmdb -> @zmdb/jobs');
  });

  it('rejects a portable jobs provider edge with SELECTION_PROVIDER_LEAK', () => {
    const mutation = cloneInstalledGraph(matrix.portableConsumer.graph);
    for (const name of ['@zmdb/migrations', '@zmdb/sqlite']) {
      const installed = matrix.defaultConsumer.graph.packages.get(name);
      if (installed === undefined) throw new Error(`packed default consumer omitted ${name}`);
      mutation.packages.set(name, installed);
    }
    replaceManifest(mutation.packages, '@zmdb/jobs', manifest => ({
      ...manifest,
      dependencies: {
        '@zmdb/app': RELEASE_VERSION,
        '@zmdb/sqlite': RELEASE_VERSION,
      },
    }));
    expect(selectionDiagnostics(mutation.graph())).toContain('SELECTION_PROVIDER_LEAK: @zmdb/jobs -> @zmdb/sqlite');
  });

  it('rejects a mismatched provider technology with SELECTION_PROVIDER_MISMATCH', () => {
    const mutation = cloneInstalledGraph(matrix.postgresConsumer.graph);
    for (const name of ['@zmdb/migrations', '@zmdb/sqlite']) {
      const installed = matrix.defaultConsumer.graph.packages.get(name);
      if (installed === undefined) throw new Error(`packed default consumer omitted ${name}`);
      mutation.packages.set(name, installed);
    }
    replaceManifest(mutation.packages, '@zmdb/jobs', manifest => ({
      ...manifest,
      dependencies: { '@zmdb/app': RELEASE_VERSION },
    }));
    replaceManifest(mutation.packages, '@zmdb/jobs-postgres', manifest => ({
      ...manifest,
      dependencies: {
        ...manifest.dependencies,
        '@zmdb/sqlite': RELEASE_VERSION,
      },
    }));
    expect(selectionDiagnostics(mutation.graph(), { pg: '8.23.0' })).toContain(
      'SELECTION_PROVIDER_MISMATCH: @zmdb/jobs-postgres -> @zmdb/sqlite',
    );
  });

  it('rejects changed direct-edge or closure budgets with SELECTION_BUDGET_DRIFT', () => {
    const mutation = cloneInstalledGraph(matrix.defaultConsumer.graph);
    replaceManifest(mutation.packages, 'zmdb', manifest => {
      const dependencies = { ...manifest.dependencies };
      delete dependencies['@zmdb/web'];
      return { ...manifest, dependencies };
    });
    expect(selectionDiagnostics(mutation.graph())).toEqual([
      expect.stringContaining('SELECTION_BUDGET_DRIFT: zmdb official closure'),
    ]);
  });

  it('rejects a missing or out-of-range provider peer with SELECTION_PEER_MISSING', () => {
    expect(selectionDiagnostics(matrix.postgresConsumer.graph)).toContain(
      'SELECTION_PEER_MISSING: @zmdb/jobs-postgres requires pg@^8.23.0; selected none',
    );
    expect(selectionDiagnostics(matrix.postgresConsumer.graph, { pg: '8.22.0' })).toContain(
      'SELECTION_PEER_MISSING: @zmdb/jobs-postgres requires pg@^8.23.0; selected 8.22.0',
    );
  });

  it('rejects a zmdb jobs facade with SELECTION_FACADE_FORBIDDEN', () => {
    const mutation = cloneInstalledGraph(matrix.defaultConsumer.graph);
    replaceManifest(mutation.packages, 'zmdb', manifest => ({
      ...manifest,
      exports: { ...manifest.exports, './jobs': './dist/jobs.js' },
    }));
    expect(selectionDiagnostics(mutation.graph())).toContain(
      'SELECTION_FACADE_FORBIDDEN: zmdb exports a jobs runtime facade',
    );
  });

  it('rejects undeclared provider imports and provider-owned client shutdown', () => {
    const manifest = matrix.workspace.get('@zmdb/jobs-postgres')?.manifest;
    if (manifest === undefined) throw new Error('@zmdb/jobs-postgres manifest is absent');
    const sourceText = [
      "import { sqliteDriver } from '@zmdb/sqlite';",
      "import type { Pool } from 'pg';",
      'export const close = (client: Pool) => client.end();',
      'void sqliteDriver;',
    ].join('\n');
    expect(providerSourceProblems('@zmdb/jobs-postgres', sourceText, manifest)).toEqual([
      'SELECTION_PROVIDER_MISMATCH: @zmdb/jobs-postgres closes or releases a caller-owned client',
      'SELECTION_PROVIDER_MISMATCH: @zmdb/jobs-postgres imports undeclared @zmdb/sqlite',
    ]);
  });

  it('cleans temporary packages, databases, and caches after success and failure', () => {
    let successPath = '';
    const value = withTemporaryDirectory(directory => {
      successPath = directory;
      mkdirSync(join(directory, 'npm-cache'), { recursive: true });
      writeFileSync(join(directory, 'database.sqlite'), 'temporary');
      return 42;
    });
    expect(value).toBe(42);
    expect(existsSync(successPath)).toBe(false);

    let failurePath = '';
    expect(() =>
      withTemporaryDirectory(directory => {
        failurePath = directory;
        mkdirSync(join(directory, 'npm-cache'), { recursive: true });
        writeFileSync(join(directory, 'database.sqlite'), 'temporary');
        throw new Error('deliberate fixture failure');
      }),
    ).toThrow('deliberate fixture failure');
    expect(existsSync(failurePath)).toBe(false);
  });
});
