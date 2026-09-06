import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runEmbedded, type EmbeddedConnection } from '@zmdb/migrations/embedded';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyseToolingBoundaries,
  GENERATED_ARTIFACTS,
  RETIRED_AOT_TOOLING_EXPORTS,
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_BIN,
  TARGET_TOOLING_EXPORTS,
} from '../../../.github/scripts/verify-tooling-boundaries.mjs';
import { loadGovernanceSnapshot } from '../../../scripts/architecture/governance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
const ARCHITECTURE = GOVERNANCE.architecture;
if (ARCHITECTURE === null) throw new Error('governance snapshot has no architecture');
const analyseTooling = () => analyseToolingBoundaries({ architecture: ARCHITECTURE, snapshot: GOVERNANCE });
const PACKAGES = join(ROOT, 'packages');
const FIXTURES = join(ROOT, 'fixtures');
const HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const CURRENT_OWNER_DIRECTORIES = [
  'ai',
  'query-compiler',
  'schema-core',
  'aot-validator',
  'repository',
  'mssql',
  'sqlite',
  'app',
  'web',
  'zmdb',
];
const TARGET_DIRECTORIES = {
  '@zmdb/compiler': 'compiler',
  '@zmdb/migrations': 'migrations',
  '@zmdb/cli': 'cli',
} as const;
const BASELINE_TARGET_OWNER = {
  '@zmdb/compiler': 'aot-validator',
  '@zmdb/migrations': 'query-compiler',
  '@zmdb/cli': 'zmdb',
} as const;
const OWNER_DIRECTORIES = [
  ...CURRENT_OWNER_DIRECTORIES,
  ...Object.values(TARGET_DIRECTORIES).filter(directory => existsSync(join(PACKAGES, directory, 'package.json'))),
];
const CURRENT_CLI_COMMANDS = [
  'check',
  'embed',
  'export',
  'generate',
  'migrate',
  'modules',
  'new',
  'pull',
  'push',
  'repl',
  'rollback',
  'status',
  'studio',
  'up',
  'upgrade',
] as const;
const TARGET_CLI_INVOCATIONS = [
  ['check'],
  ['codegen'],
  ['embed'],
  ['export'],
  ['generate'],
  ['migrate'],
  ['modules'],
  ['new'],
  ['pull'],
  ['push'],
  ['repl'],
  ['rollback'],
  ['status'],
  ['studio'],
  ['upgrade'],
  ['client', 'generate'],
] as const;

interface PackageManifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

interface PackedPackage {
  readonly directory: string;
  readonly manifest: PackageManifest;
}

interface ImportResult {
  readonly ok: boolean;
  readonly keys?: readonly string[];
  readonly code?: string;
  readonly message?: string;
}

interface IdentityResult extends ImportResult {
  readonly same?: boolean;
}

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface PackedFixture {
  readonly directory: string;
  readonly fullApp: string;
  readonly compilerApp: string;
  readonly migrationsApp: string;
  readonly cliApp: string;
  readonly packages: ReadonlyMap<string, PackedPackage>;
}

interface TypecheckResult extends CommandResult {
  readonly fixture: string;
  readonly directory: string;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function npmPackFilename(output: string): string {
  const report: unknown = JSON.parse(output);
  const entry = Array.isArray(report) ? report[0] : isRecord(report) ? Object.values(report)[0] : undefined;
  if (!isRecord(entry) || typeof entry['filename'] !== 'string') {
    throw new Error(`npm pack returned no filename: ${output}`);
  }
  return entry['filename'];
}

function packagePath(nodeModules: string, packageName: string): string {
  return join(nodeModules, ...packageName.split('/'));
}

function linkDirectory(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function linkExternalDependencies(nodeModules: string, excluded: ReadonlySet<string> = new Set()): void {
  const source = join(ROOT, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '@zmdb' || entry.name === 'zmdb') continue;
    const from = join(source, entry.name);
    if (!entry.name.startsWith('@')) {
      if (excluded.has(entry.name)) continue;
      linkDirectory(from, join(nodeModules, entry.name));
      continue;
    }
    const scope = join(nodeModules, entry.name);
    mkdirSync(scope, { recursive: true });
    for (const child of readdirSync(from, { withFileTypes: true })) {
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      if (excluded.has(`${entry.name}/${child.name}`)) continue;
      linkDirectory(join(from, child.name), join(scope, child.name));
    }
  }
}

function installPacked(
  packed: ReadonlyMap<string, PackedPackage>,
  nodeModules: string,
  packageName: string,
  owner: string,
  copy = false,
): void {
  const value = packed.get(owner);
  if (value === undefined) throw new Error(`no packed owner ${owner}`);
  const destination = packagePath(nodeModules, packageName);
  mkdirSync(dirname(destination), { recursive: true });
  if (copy) {
    const app = dirname(nodeModules);
    const isolated = join(app, 'packages', ...packageName.split('/'));
    cpSync(value.directory, isolated, { recursive: true });
    linkDirectory(isolated, destination);
  } else {
    linkDirectory(value.directory, destination);
  }
}

function createPackedApp(
  directory: string,
  name: string,
  packed: ReadonlyMap<string, PackedPackage>,
  installs: readonly {
    readonly packageName: string;
    readonly owner: string;
    readonly copy?: boolean;
  }[],
  excludedExternal: ReadonlySet<string> = new Set(),
): string {
  const app = join(directory, name);
  const nodeModules = join(app, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  linkExternalDependencies(nodeModules, excludedExternal);
  for (const install of installs) {
    installPacked(packed, nodeModules, install.packageName, install.owner, install.copy === true);
  }
  return app;
}

function materializeBins(app: string, packageName: string): readonly string[] {
  const packageDirectory = packagePath(join(app, 'node_modules'), packageName);
  const manifest = readJson<PackageManifest>(join(packageDirectory, 'package.json'));
  const binDirectory = join(app, 'node_modules', '.bin');
  mkdirSync(binDirectory, { recursive: true });
  for (const [command, target] of Object.entries(normalizeBins(manifest))) {
    const link = join(binDirectory, command);
    if (existsSync(link)) throw new Error(`duplicate installed command ${command}`);
    symlinkSync(relative(binDirectory, join(packageDirectory, target)), link);
  }
  return readdirSync(binDirectory).toSorted();
}

function targetOwnerDirectory(
  packed: ReadonlyMap<string, PackedPackage>,
  packageName: keyof typeof TARGET_DIRECTORIES,
): string {
  const target = TARGET_DIRECTORIES[packageName];
  return packed.has(target) ? target : BASELINE_TARGET_OWNER[packageName];
}

function targetPackedPackage(
  fixture: PackedFixture,
  packageName: keyof typeof TARGET_DIRECTORIES,
): PackedPackage | undefined {
  return fixture.packages.get(targetOwnerDirectory(fixture.packages, packageName));
}

function packWorkspace(): PackedFixture {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-tooling-boundary-'));
  const store = join(directory, 'store');
  mkdirSync(store, { recursive: true });

  const packed = new Map<string, PackedPackage>();
  for (const owner of OWNER_DIRECTORIES) {
    const source = join(PACKAGES, owner);
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', directory], {
      cwd: source,
      encoding: 'utf8',
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    const unpacked = join(store, owner);
    mkdirSync(unpacked, { recursive: true });
    execFileSync('tar', ['-xzf', join(directory, npmPackFilename(output)), '-C', unpacked, '--strip-components=1']);
    const manifest = readJson<PackageManifest>(join(unpacked, 'package.json'));
    if (typeof manifest.name !== 'string') throw new Error(`${owner} packed without a package name`);
    packed.set(owner, { directory: unpacked, manifest });
  }

  const storeModules = join(store, 'node_modules');
  linkExternalDependencies(storeModules);
  for (const value of packed.values()) {
    const packageName = value.manifest.name;
    if (packageName === undefined) continue;
    linkDirectory(value.directory, packagePath(storeModules, packageName));
  }

  const fullInstalls = [...packed.entries()].map(([owner, value]) => ({
    packageName: value.manifest.name ?? owner,
    owner,
  }));
  const installedNames = new Set(fullInstalls.map(install => install.packageName));
  const targetInstalls = Object.keys(TARGET_DIRECTORIES)
    .filter(packageName => !installedNames.has(packageName))
    .map(packageName => ({
      packageName,
      owner: targetOwnerDirectory(packed, packageName as keyof typeof TARGET_DIRECTORIES),
    }));
  const fullApp = createPackedApp(directory, 'full-app', packed, [...fullInstalls, ...targetInstalls]);
  const compilerApp = createPackedApp(directory, 'compiler-app', packed, [
    { packageName: '@zmdb/compiler', owner: targetOwnerDirectory(packed, '@zmdb/compiler'), copy: true },
    { packageName: '@zmdb/ai', owner: 'ai' },
    { packageName: '@zmdb/aot-validator', owner: 'aot-validator' },
    { packageName: '@zmdb/query-compiler', owner: 'query-compiler' },
    { packageName: '@zmdb/schema-core', owner: 'schema-core' },
  ]);
  const migrationsApp = createPackedApp(
    directory,
    'migrations-app',
    packed,
    [
      {
        packageName: '@zmdb/migrations',
        owner: targetOwnerDirectory(packed, '@zmdb/migrations'),
        copy: true,
      },
      { packageName: '@zmdb/query-compiler', owner: 'query-compiler' },
    ],
    new Set(['esbuild', 'metro', 'metro-babel-transformer', 'oxlint', 'typescript']),
  );
  const cliApp = createPackedApp(
    directory,
    'cli-app',
    packed,
    [
      { packageName: '@zmdb/cli', owner: targetOwnerDirectory(packed, '@zmdb/cli'), copy: true },
      { packageName: '@zmdb/compiler', owner: targetOwnerDirectory(packed, '@zmdb/compiler'), copy: true },
      {
        packageName: '@zmdb/migrations',
        owner: targetOwnerDirectory(packed, '@zmdb/migrations'),
        copy: true,
      },
      { packageName: '@zmdb/ai', owner: 'ai' },
      { packageName: '@zmdb/aot-validator', owner: 'aot-validator' },
      { packageName: '@zmdb/query-compiler', owner: 'query-compiler' },
      { packageName: '@zmdb/schema-core', owner: 'schema-core' },
    ],
    new Set(['esbuild']),
  );
  materializeBins(cliApp, '@zmdb/cli');

  return { directory, fullApp, compilerApp, migrationsApp, cliApp, packages: packed };
}

function importPacked(app: string, specifiers: readonly string[]): Readonly<Record<string, ImportResult>> {
  const source = `const out = {};
for (const specifier of ${JSON.stringify(specifiers)}) {
  try {
    const module = await import(specifier);
    out[specifier] = { ok: true, keys: Object.keys(module).toSorted() };
  } catch (error) {
    out[specifier] = {
      ok: false,
      code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
process.stdout.write(JSON.stringify(out));
`;
  const output = execFileSync(process.execPath, [`--import=${HOOK}`, '--input-type=module', '--eval', source], {
    cwd: app,
    encoding: 'utf8',
  });
  return JSON.parse(output) as Readonly<Record<string, ImportResult>>;
}

function productIdentityChecks(app: string): Readonly<Record<string, IdentityResult>> {
  const checks = {
    compiler: ['zmdb/compiler', '@zmdb/compiler', ['compileProject', 'writeCompileResult']],
    config: ['zmdb/config', '@zmdb/compiler/config', ['defineConfig', 'loadConfig', 'resolveConfig']],
    migrations: ['zmdb/migrations', '@zmdb/migrations', ['diff', 'planMigration', 'snapshot']],
    cli: ['zmdb/cli', '@zmdb/cli', ['runCli']],
  };
  const source = `const out = {};
for (const [name, [productSpecifier, implementationSpecifier, exports]] of Object.entries(${JSON.stringify(checks)})) {
  try {
    const [product, implementation] = await Promise.all([
      import(productSpecifier),
      import(implementationSpecifier),
    ]);
    out[name] = {
      ok: true,
      same: exports.every(exportName => product[exportName] === implementation[exportName]),
    };
  } catch (error) {
    out[name] = {
      ok: false,
      code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
process.stdout.write(JSON.stringify(out));
`;
  const result = runNode(app, [`--import=${HOOK}`, '--input-type=module', '--eval', source]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout) as Readonly<Record<string, IdentityResult>>;
}

function copyAndTypecheck(
  fixture: PackedFixture,
  app: string,
  source: string,
  config: string,
  label: string,
): TypecheckResult {
  const destination = join(fixture.directory, `consumer-${label}`);
  cpSync(source, destination, { recursive: true });
  linkDirectory(join(app, 'node_modules'), join(destination, 'node_modules'));
  const result = spawnSync(process.execPath, [TSC, '--noEmit', '-p', join(destination, config)], {
    cwd: destination,
    encoding: 'utf8',
  });
  return {
    fixture: relative(ROOT, source),
    directory: destination,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function typecheckCopied(directory: string, config: string, fixture: string): TypecheckResult {
  const result = spawnSync(process.execPath, [TSC, '--noEmit', '-p', join(directory, config)], {
    cwd: directory,
    encoding: 'utf8',
  });
  return {
    fixture,
    directory,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function withoutCompilerShutdownNoise(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter(
      line =>
        line !== 'context canceled' &&
        !line.includes('ExperimentalWarning: SQLite is an experimental feature') &&
        !line.includes('(Use `node --trace-warnings'),
    )
    .join('\n')
    .trim();
}

function runNode(app: string, args: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, args, { cwd: app, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: withoutCompilerShutdownNoise(result.stderr ?? ''),
  };
}

function runBin(app: string, args: readonly string[]): CommandResult {
  return runNode(app, [`--import=${HOOK}`, join(app, 'node_modules', '.bin', 'zmdb'), ...args]);
}

function packageSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return packageSources(path);
    return entry.isFile() &&
      (path.endsWith('.ts') || path.endsWith('.js')) &&
      !path.endsWith('.spec.ts') &&
      !path.endsWith('.type-test.ts') &&
      !path.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

type TargetToolingPackage = keyof typeof TARGET_TOOLING_EXPORTS & string;

function targetSpecifiers(packageName: TargetToolingPackage): readonly string[] {
  return TARGET_TOOLING_EXPORTS[packageName].map(subpath =>
    subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`,
  );
}

function normalizeBins(manifest: PackageManifest): Readonly<Record<string, string>> {
  if (typeof manifest.bin === 'string') return { [manifest.name ?? '']: manifest.bin };
  return manifest.bin ?? {};
}

function importedNames(directory: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const file of packageSources(directory)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/import\s*{([\s\S]*?)}\s*from\s*['"]([^'"]+)['"]/g)) {
      const names = (match[1] ?? '')
        .split(',')
        .map(
          name =>
            name
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0] ?? '',
        )
        .filter(Boolean);
      for (const name of names) {
        const specifiers = found.get(name) ?? [];
        specifiers.push(match[2] ?? '');
        found.set(name, specifiers);
      }
    }
  }
  return found;
}

function fixtureContracts(): readonly { readonly directory: string; readonly config: string }[] {
  return [
    { directory: join(FIXTURES, 'consumer-compiler'), config: 'tsconfig.fixture.json' },
    { directory: join(FIXTURES, 'consumer-migrations'), config: 'tsconfig.fixture.json' },
    { directory: join(FIXTURES, 'consumer-cli'), config: 'tsconfig.installed.json' },
  ];
}

let packed: PackedFixture | undefined;
let compilerImports: Readonly<Record<string, ImportResult>> = {};
let migrationsImports: Readonly<Record<string, ImportResult>> = {};
let cliImports: Readonly<Record<string, ImportResult>> = {};
let productIdentities: Readonly<Record<string, IdentityResult>> = {};
let compilerTypes: TypecheckResult | undefined;
let compilerMetroTypes: TypecheckResult | undefined;
let migrationsTypes: TypecheckResult | undefined;
let cliTypes: TypecheckResult | undefined;
let installedCli: CommandResult | undefined;
let compilerSmoke: CommandResult | undefined;
let migrationsSmoke: CommandResult | undefined;
let targetCliVersion: CommandResult | undefined;
let targetCliHelp: CommandResult | undefined;
let targetCliInvalid: CommandResult | undefined;
const currentCliHelp = new Map<string, CommandResult>();
const targetCliHelpByCommand = new Map<string, CommandResult>();

function packedFixture(): PackedFixture {
  if (packed === undefined) throw new Error('packed fixture was not prepared');
  return packed;
}

beforeAll(() => {
  packed = packWorkspace();
  const fixture = packedFixture();
  compilerImports = importPacked(fixture.compilerApp, targetSpecifiers('@zmdb/compiler'));
  migrationsImports = importPacked(fixture.migrationsApp, targetSpecifiers('@zmdb/migrations'));
  cliImports = importPacked(fixture.cliApp, targetSpecifiers('@zmdb/cli'));
  productIdentities = productIdentityChecks(fixture.fullApp);
  compilerTypes = copyAndTypecheck(
    fixture,
    fixture.compilerApp,
    join(FIXTURES, 'consumer-compiler'),
    'tsconfig.fixture.json',
    'compiler',
  );
  compilerMetroTypes = typecheckCopied(
    compilerTypes.directory,
    'tsconfig.metro.json',
    'fixtures/consumer-compiler/tsconfig.metro.json',
  );
  migrationsTypes = copyAndTypecheck(
    fixture,
    fixture.migrationsApp,
    join(FIXTURES, 'consumer-migrations'),
    'tsconfig.fixture.json',
    'migrations',
  );
  cliTypes = copyAndTypecheck(
    fixture,
    fixture.cliApp,
    join(FIXTURES, 'consumer-cli'),
    'tsconfig.installed.json',
    'cli',
  );

  const compilerProject = compilerTypes.directory;
  const compilerModel = join(compilerProject, 'src', 'model.ts');
  compilerSmoke = runNode(fixture.compilerApp, [
    `--import=${HOOK}`,
    '--input-type=module',
    '--eval',
    `const { compileProject, writeCompileResult } = await import('@zmdb/compiler');
const result = await compileProject({
  project: ${JSON.stringify(join(compilerProject, 'tsconfig.fixture.json'))},
  files: [${JSON.stringify(compilerModel)}],
});
const checked = await writeCompileResult(result, { check: true });
const materialized = await writeCompileResult(result);
const recompiled = await compileProject({
  project: ${JSON.stringify(join(compilerProject, 'tsconfig.fixture.json'))},
  files: [${JSON.stringify(compilerModel)}],
});
const rechecked = await writeCompileResult(recompiled, { check: true });
const model = await import(${JSON.stringify(pathToFileURL(compilerModel).href)});
process.stdout.write(JSON.stringify({
  files: result.files.length,
  artifacts: result.artifacts.length,
  diagnostics: result.diagnostics.length,
  initialStale: checked.stale.length,
  written: materialized.written.length,
  recheckStale: rechecked.stale.length,
  good: model.acceptsCompilerFixtureUser({ id: 1, email: 'user@example.com' }),
  bad: model.acceptsCompilerFixtureUser({ id: '1', email: 'user@example.com' }),
}));
`,
  ]);

  migrationsSmoke = runNode(fixture.migrationsApp, [
    `--import=${HOOK}`,
    '--input-type=module',
    '--eval',
    `const { diff, planMigration, snapshot } = await import('@zmdb/migrations');
const { emitDeclarations } = await import('@zmdb/migrations/declarations');
const { runEmbedded } = await import('@zmdb/migrations/embedded');
const { readMigrations } = await import('@zmdb/migrations/files');
const introspectionApi = await import('@zmdb/migrations/introspect');
const fixtureDialect = {
  name: 'fixture',
  migrations: {
    foreignKeyMode: 'inline',
    validatePlan() {},
  },
};
const officialIntrospectionRegistryAbsent = [
  'postgres',
  'postgresIntrospector',
  'mysql',
  'mysqlIntrospector',
].every(name => !(name in introspectionApi));
const previous = snapshot([]);
const next = snapshot([{
  table: 'widgets',
  primaryKey: ['id'],
  columns: { id: { type: 'integer', flags: { nullable: false, primaryKey: true } } },
}]);
const operations = diff(previous, next);
const plan = planMigration(previous, next, {
  dialect: fixtureDialect,
  emitUp: operation => 'up:' + operation.kind,
  emitDown: operation => 'down:' + operation.kind,
});
const declarations = await emitDeclarations(previous, { dialect: fixtureDialect });
const files = await readMigrations(${JSON.stringify(join(fixture.migrationsApp, 'missing-migrations'))});
const ledger = [];
let ready = false;
const connection = {
  exec(sql) { if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) ready = true; },
  run(_sql, params) { ledger.push({ version: params[0], name: params[1], checksum: params[3] }); },
  rows(sql) {
    if (sql.startsWith("SELECT name FROM pragma_table_info")) {
      return ready ? [{ name: 'version' }, { name: 'name' }, { name: 'applied_at' }, { name: 'checksum' }] : [];
    }
    return ledger;
  },
};
const applied = await runEmbedded(connection, [
  { version: 2, name: 'second', up: 'SELECT 2', checksum: 'sha256:second' },
  { version: 1, name: 'first', up: 'SELECT 1', checksum: 'sha256:first' },
]);
process.stdout.write(JSON.stringify({
  operations: operations.length,
  plan: plan.operations.length,
  declarations: declarations.files.length,
  files: files.length,
  dialect: fixtureDialect.name,
  officialIntrospectionRegistryAbsent,
  applied,
}));
`,
  ]);

  const zmdb = fixture.packages.get('zmdb');
  if (zmdb === undefined) throw new Error('the packed zmdb owner is missing');
  const bin = Object.values(normalizeBins(zmdb.manifest))[0];
  if (bin === undefined) throw new Error('the packed zmdb owner has no executable');
  const currentBin = (...args: readonly string[]): CommandResult =>
    runNode(fixture.fullApp, [`--import=${HOOK}`, join(zmdb.directory, bin), ...args]);
  installedCli = currentBin('--version');
  for (const command of CURRENT_CLI_COMMANDS) currentCliHelp.set(command, currentBin(command, '--help'));

  targetCliVersion = runBin(fixture.cliApp, ['--version']);
  targetCliHelp = runBin(fixture.cliApp, ['--help']);
  targetCliInvalid = runBin(fixture.cliApp, ['not-a-command']);
  for (const invocation of TARGET_CLI_INVOCATIONS) {
    targetCliHelpByCommand.set(invocation.join(' '), runBin(fixture.cliApp, [...invocation, '--help']));
  }
}, 120_000);

afterAll(() => {
  if (packed !== undefined) rmSync(packed.directory, { recursive: true, force: true });
});

describe('standalone tooling package fixtures (#627)', () => {
  it('uses versioned packed-package dependencies with no workspace path map', () => {
    for (const { directory, config } of fixtureContracts()) {
      const manifest = readJson<PackageManifest>(join(directory, 'package.json'));
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        expect(version, `${relative(ROOT, directory)} dependency ${name}`).not.toMatch(
          /^(?:workspace|file|link|portal):/,
        );
      }
      const tsconfig = readJson<{
        readonly compilerOptions?: {
          readonly allowImportingTsExtensions?: boolean;
          readonly paths?: unknown;
          readonly skipLibCheck?: boolean;
        };
      }>(join(directory, config));
      expect(tsconfig.compilerOptions?.paths, `${relative(ROOT, directory)} paths`).toBeUndefined();
      expect(tsconfig.compilerOptions?.allowImportingTsExtensions).toBe(false);
      expect(tsconfig.compilerOptions?.skipLibCheck).toBe(false);
    }
    expect(
      Object.keys(
        readJson<PackageManifest>(join(FIXTURES, 'consumer-compiler', 'package.json')).dependencies ?? {},
      ).toSorted(),
    ).toEqual(['@zmdb/aot-validator', '@zmdb/compiler', '@zmdb/schema-core', 'typescript']);
    expect(
      Object.keys(
        readJson<PackageManifest>(join(FIXTURES, 'consumer-migrations', 'package.json')).dependencies ?? {},
      ).toSorted(),
    ).toEqual(['@zmdb/migrations']);
    expect(
      Object.keys(
        readJson<PackageManifest>(join(FIXTURES, 'consumer-cli', 'package.json')).dependencies ?? {},
      ).toSorted(),
    ).toEqual(['@zmdb/cli', '@zmdb/compiler', '@zmdb/migrations']);

    const fixture = packedFixture();
    expect(existsSync(packagePath(join(fixture.compilerApp, 'node_modules'), '@zmdb/migrations'))).toBe(false);
    expect(existsSync(packagePath(join(fixture.compilerApp, 'node_modules'), '@zmdb/cli'))).toBe(false);
    expect(existsSync(packagePath(join(fixture.migrationsApp, 'node_modules'), '@zmdb/compiler'))).toBe(false);
    expect(existsSync(packagePath(join(fixture.migrationsApp, 'node_modules'), '@zmdb/cli'))).toBe(false);
    expect(existsSync(packagePath(join(fixture.migrationsApp, 'node_modules'), 'typescript'))).toBe(false);
    expect(existsSync(packagePath(join(fixture.cliApp, 'node_modules'), '@zmdb/web'))).toBe(false);
    expect(existsSync(join(fixture.cliApp, 'node_modules', 'esbuild'))).toBe(false);
    expect(readdirSync(join(fixture.cliApp, 'node_modules', '.bin')).toSorted()).toEqual(['zmdb']);
  });

  it('keeps the existing embedded runner ordered and filesystem-free while ownership moves', async () => {
    const connection = new MemoryEmbeddedConnection();
    const applied = await runEmbedded(connection, [
      { version: 2, name: 'second', up: 'CREATE TABLE second(id INTEGER)', checksum: 'sha256:second' },
      { version: 1, name: 'first', up: 'CREATE TABLE first(id INTEGER)', checksum: 'sha256:first' },
    ]);
    expect(applied).toEqual([1, 2]);
    expect(connection.migrationSql).toEqual(['CREATE TABLE first(id INTEGER)', 'CREATE TABLE second(id INTEGER)']);
    expect(analyseTooling().embeddedViolations).toEqual([]);
  });

  it('executes the current packed bin and every currently shipped command help route', () => {
    expect(installedCli).toMatchObject({ status: 0, stderr: '' });
    expect(installedCli?.stdout).toMatch(/^zmdb \d/);
    expect([...currentCliHelp.keys()]).toEqual([...CURRENT_CLI_COMMANDS]);
    for (const [command, result] of currentCliHelp) {
      expect(result, command).toMatchObject({ status: 0, stderr: '' });
      expect(result.stdout, command).toContain('Usage:');
    }
  });

  it('loads direct codegen, unplugin, Metro and lint subpaths from the packed package', () => {
    const owner = targetPackedPackage(packedFixture(), '@zmdb/compiler');
    expect(owner).toBeDefined();
    expect.soft(owner?.manifest.name).toBe('@zmdb/compiler');
    expect
      .soft(Object.keys(owner?.manifest.exports ?? {}).toSorted())
      .toEqual([...TARGET_TOOLING_EXPORTS['@zmdb/compiler']]);
    for (const specifier of targetSpecifiers('@zmdb/compiler')) {
      expect.soft(compilerImports[specifier], specifier).toMatchObject({ ok: true });
    }
    expect.soft(compilerImports['@zmdb/compiler']?.keys).toContain('compileProject');
    expect.soft(compilerImports['@zmdb/compiler']?.keys).toContain('writeCompileResult');
    expect.soft(compilerTypes?.status, compilerTypes?.stderr || compilerTypes?.stdout).toBe(0);
    expect.soft(compilerMetroTypes?.status, compilerMetroTypes?.stderr || compilerMetroTypes?.stdout).toBe(0);
    expect.soft(productIdentities['compiler']).toEqual({ ok: true, same: true });
    expect.soft(productIdentities['config']).toEqual({ ok: true, same: true });
    expect.soft(compilerSmoke, compilerSmoke?.stderr || compilerSmoke?.stdout).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect.soft(JSON.parse(compilerSmoke?.stdout ?? '{}')).toEqual({
      files: 1,
      artifacts: 1,
      diagnostics: 0,
      initialStale: 4,
      written: 4,
      recheckStale: 0,
      good: true,
      bad: false,
    });
  });

  it('runs embedded migrations from a packed package with no filesystem or formatter reachability', () => {
    const owner = targetPackedPackage(packedFixture(), '@zmdb/migrations');
    expect.soft(owner?.manifest.name).toBe('@zmdb/migrations');
    expect
      .soft(Object.keys(owner?.manifest.exports ?? {}).toSorted())
      .toEqual([...TARGET_TOOLING_EXPORTS['@zmdb/migrations']]);
    for (const specifier of targetSpecifiers('@zmdb/migrations')) {
      expect.soft(migrationsImports[specifier], specifier).toMatchObject({ ok: true });
    }
    expect.soft(migrationsTypes?.status, migrationsTypes?.stderr || migrationsTypes?.stdout).toBe(0);
    expect.soft(productIdentities['migrations']).toEqual({ ok: true, same: true });
    expect.soft(migrationsSmoke, migrationsSmoke?.stderr || migrationsSmoke?.stdout).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect.soft(migrationsSmoke?.stdout).toContain('"applied":[1,2]');
    expect.soft(migrationsSmoke?.stdout).toContain('"dialect":"fixture"');
    expect.soft(migrationsSmoke?.stdout).toContain('"officialIntrospectionRegistryAbsent":true');
    expect.soft(analyseTooling().embeddedViolations).toEqual([]);
    expect.soft(analyseTooling().formatterViolations).toEqual([]);
  });

  it.fails('runs the installed zmdb executable from @zmdb/cli and dispatches every command once', () => {
    const fixture = packedFixture();
    const owner = targetPackedPackage(fixture, '@zmdb/cli');
    expect.soft(owner?.manifest.name).toBe('@zmdb/cli');
    expect.soft(Object.keys(owner?.manifest.exports ?? {}).toSorted()).toEqual(['.']);
    expect.soft(normalizeBins(owner?.manifest ?? {})).toEqual({ zmdb: './src/bin.ts' });
    expect
      .soft(realpathSync(join(fixture.cliApp, 'node_modules', '.bin', 'zmdb')))
      .toContain(join(fixture.cliApp, 'packages', '@zmdb', 'cli'));
    expect.soft(cliImports['@zmdb/cli']).toMatchObject({ ok: true });
    expect.soft(cliImports['@zmdb/cli']?.keys).toContain('runCli');
    expect.soft(cliTypes?.status, cliTypes?.stderr || cliTypes?.stdout).toBe(0);
    expect.soft(productIdentities['cli']).toEqual({ ok: true, same: true });

    expect.soft(targetCliVersion).toMatchObject({ status: 0, stderr: '' });
    expect.soft(targetCliVersion?.stdout).toMatch(/^zmdb \d/);
    expect.soft(targetCliHelp).toMatchObject({ status: 0, stderr: '' });
    expect.soft(targetCliHelp?.stdout).toContain('Usage:');
    expect.soft(targetCliInvalid).toMatchObject({ status: 2, stdout: '' });
    expect.soft(targetCliInvalid?.stderr).toContain('unknown command');
    expect.soft([...targetCliHelpByCommand.keys()]).toEqual(TARGET_CLI_INVOCATIONS.map(parts => parts.join(' ')));
    for (const [command, result] of targetCliHelpByCommand) {
      expect.soft(result, command).toMatchObject({ status: 0, stderr: '' });
      expect.soft(result.stdout, command).toContain('Usage:');
    }

    const cliDirectory = realpathSync(packagePath(join(fixture.cliApp, 'node_modules'), '@zmdb/cli'));
    const imports = importedNames(cliDirectory);
    const delegations = {
      compileProject: '@zmdb/compiler',
      writeCompileResult: '@zmdb/compiler',
      generateMigration: '@zmdb/migrations/files',
      embedMigrations: '@zmdb/migrations/files',
      migrate: '@zmdb/migrations/files',
      rollback: '@zmdb/migrations/files',
      migrationStatus: '@zmdb/migrations/files',
      planPush: '@zmdb/migrations/files',
      applyPush: '@zmdb/migrations/files',
      checkProject: '@zmdb/migrations/files',
      upgradeSnapshot: '@zmdb/migrations/files',
      exportSchema: '@zmdb/migrations/files',
      pullDeclarations: '@zmdb/migrations/files',
    } as const;
    for (const [operation, packageName] of Object.entries(delegations)) {
      expect.soft(imports.get(operation), operation).toEqual([packageName]);
    }

    const source = packageSources(cliDirectory)
      .map(file => readFileSync(file, 'utf8'))
      .join('\n');
    for (const command of ['new', 'modules', 'repl', 'studio', 'client']) {
      expect
        .soft(source, `lazy command ${command}`)
        .toMatch(new RegExp(`import\\(\\s*['"][^'"]*${command}[^'"]*['"]\\s*\\)`));
    }
    expect.soft(source).not.toMatch(/@zmdb\/(?:aot-validator|query-compiler)\/(?:codegen|introspect|migrations)/);
    expect.soft(source).not.toMatch(/(?:\.\.\/)+packages\/[^/]+\/src/);
  });
});

describe('tooling isolation and removal boundaries (#627)', () => {
  it('generates no import of @zmdb/compiler in application runtime output', () => {
    const analysis = analyseTooling();
    expect
      .soft(
        analysis.generatedViolations.filter(violation => /^@zmdb\/compiler(?:\/|$)/.test(violation.specifier ?? '')),
      )
      .toEqual([]);

    const runtimeImports = GENERATED_ARTIFACTS.filter(path => path.endsWith('.js')).flatMap(path => {
      const source = readFileSync(join(ROOT, path), 'utf8');
      return [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1] ?? '');
    });
    expect
      .soft(runtimeImports.some(specifier => /^@zmdb\/(?:aot-validator|protobuf)(?:\/|$)/.test(specifier)))
      .toBe(true);
    expect.soft(runtimeImports.some(specifier => /^@zmdb\/compiler(?:\/|$)/.test(specifier))).toBe(false);

    const aot = readJson<PackageManifest>(join(PACKAGES, 'aot-validator', 'package.json'));
    expect(normalizeBins(aot)).toEqual({});
    for (const subpath of RETIRED_AOT_TOOLING_EXPORTS) {
      expect.soft(aot.exports, `@zmdb/aot-validator ${subpath}`).not.toHaveProperty(subpath);
    }
  });

  it('keeps every runtime root unreachable from TypeScript, oxfmt, CLI, REPL, Studio and scaffolding', () => {
    expect(analyseTooling().runtimeViolations).toEqual([]);
  });

  it.fails('moves the remaining migration and CLI surfaces to their target owners', () => {
    const query = readJson<PackageManifest>(join(PACKAGES, 'query-compiler', 'package.json'));
    const product = readJson<PackageManifest>(join(PACKAGES, 'zmdb', 'package.json'));
    const cliDirectory = join(PACKAGES, 'cli', 'package.json');
    const cli = existsSync(cliDirectory) ? readJson<PackageManifest>(cliDirectory) : undefined;

    expect.soft(normalizeBins(product)).not.toHaveProperty('zmdb');
    expect.soft(cli?.name).toBe(TARGET_TOOLING_BIN.packageName);
    expect.soft(normalizeBins(cli ?? {})).toEqual({ [TARGET_TOOLING_BIN.command]: './src/bin.ts' });
    for (const [packageName, subpaths] of Object.entries(TARGET_PRODUCT_TOOLING_EXPORTS)) {
      expect.soft(product.dependencies, `zmdb dependency ${packageName}`).toHaveProperty(packageName);
      for (const subpath of subpaths) {
        expect.soft(product.exports, `zmdb facade ${subpath}`).toHaveProperty(subpath);
      }
    }

    for (const subpath of ['./introspect', './migrations', './migrations/embedded', './migrations/runner']) {
      expect.soft(query.exports, `@zmdb/query-compiler ${subpath}`).not.toHaveProperty(subpath);
    }
  });
});

class MemoryEmbeddedConnection implements EmbeddedConnection {
  readonly migrationSql: string[] = [];
  readonly #ledger: { readonly version: number; readonly name: string; readonly checksum: string }[] = [];
  #ledgerExists = false;

  async exec(sql: string): Promise<void> {
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS _zmdb_migrations')) {
      this.#ledgerExists = true;
      return;
    }
    if (sql !== 'BEGIN' && sql !== 'COMMIT' && sql !== 'ROLLBACK') this.migrationSql.push(sql);
  }

  async run(_sql: string, params: readonly (string | number | null)[]): Promise<void> {
    const [version, name, , checksum] = params;
    if (typeof version !== 'number' || typeof name !== 'string' || typeof checksum !== 'string') {
      throw new Error('invalid in-memory ledger insert');
    }
    this.#ledger.push({ version, name, checksum });
  }

  async rows(sql: string, _params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]> {
    if (sql.startsWith("SELECT name FROM pragma_table_info('_zmdb_migrations')")) {
      return this.#ledgerExists
        ? [{ name: 'version' }, { name: 'name' }, { name: 'applied_at' }, { name: 'checksum' }]
        : [];
    }
    if (sql.startsWith('SELECT version, name, checksum FROM _zmdb_migrations')) return this.#ledger;
    throw new Error(`unexpected embedded query: ${sql}`);
  }
}
