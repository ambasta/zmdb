import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { releasePlan } from '../../../scripts/release/plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT_PATH = join(ROOT, 'scripts', 'release', '__fixtures__', 'contract.json');
const AI_VERCEL_MANIFEST = join(ROOT, 'packages', 'ai-vercel', 'package.json');
const PACKAGE_MANAGER_TIMEOUT_MS = 120_000;

type Mutation =
  | 'alias'
  | 'core-drift'
  | 'duplicate-group'
  | 'internal-range'
  | 'peer-floor'
  | 'prerelease'
  | 'stale-policy'
  | 'unclassified'
  | 'undeclared-dependency';

interface PackageIdentity {
  readonly id: string;
  readonly directory: string;
  readonly npmName: string;
}

interface ReleaseContractFixture {
  readonly versions: {
    readonly core: string;
    readonly integrationNext: string;
    readonly peerFloor: string;
    readonly peerCurrent: string;
    readonly peerBelowFloor: string;
  };
  readonly packages: {
    readonly coreA: PackageIdentity;
    readonly coreB: PackageIdentity;
    readonly adapter: PackageIdentity;
  };
  readonly diagnosticCases: readonly {
    readonly name: string;
    readonly mutation: Mutation;
    readonly expected: string;
  }[];
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

interface ReleaseTargetPlan {
  readonly releaseId: string;
  readonly version: string;
  readonly packages: readonly string[];
  readonly manifestChanges: readonly {
    readonly package: string;
    readonly version: string;
    readonly ranges: Readonly<Record<string, string>>;
  }[];
}

interface ReleaseGovernanceModule {
  releaseGovernanceDiagnostics(root: string, tag: string | undefined, includeConsumers: boolean): readonly string[];
}

interface PackageManagerOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly runtimeStatus: number | null;
  readonly runtimeStdout: string;
  readonly installedPeerVersion?: string;
  readonly installedPeerRange?: string;
  readonly adapterInsideConsumer: boolean;
  readonly peerInsideConsumer: boolean;
  readonly rootDevDependencyPresent: boolean;
  readonly consumerRemoved: boolean;
  readonly cacheRemoved: boolean;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const nodeRequire = createRequire(import.meta.url);
const releaseGovernance = nodeRequire(
  join(ROOT, '.github', 'scripts', 'verify-release-governance.mjs'),
) as ReleaseGovernanceModule;

const contract = (): ReleaseContractFixture => readJson<ReleaseContractFixture>(CONTRACT_PATH);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

function packageManifest(
  identity: PackageIdentity,
  version: string,
  options: {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  } = {},
): Readonly<Record<string, unknown>> {
  return {
    name: identity.npmName,
    version,
    private: false,
    type: 'module',
    files: ['src'],
    exports: { '.': './src/index.mjs' },
    publishConfig: { access: 'public', tag: 'alpha' },
    ...options,
  };
}

function catalogSource(fixture: ReleaseContractFixture): string {
  const rows = [fixture.packages.coreA, fixture.packages.coreB, fixture.packages.adapter]
    .map(
      row => `  Object.freeze({
    id: ${JSON.stringify(row.id)},
    directory: ${JSON.stringify(row.directory)},
    npmName: ${JSON.stringify(row.npmName)},
    role: 'fixture',
    facade: Object.freeze({ root: freezeArray([]), subpaths: freezeArray([]) }),
    optionality: Object.freeze({ kind: 'required' }),
    docsOwner: ${JSON.stringify(row.id)},
    consumer: Object.freeze({ reason: 'release-contract fixture' }),
  }),`,
    )
    .join('\n');
  return `const freezeArray = values => Object.freeze([...values]);

export const PRODUCT_CATALOG = Object.freeze([
${rows}
]);
`;
}

function architecturePolicySource(fixture: ReleaseContractFixture): string {
  const { adapter, coreA, coreB } = fixture.packages;
  return `const freezeArray = values => Object.freeze([...values]);

const row = value => Object.freeze({
  ...value,
  allowedWorkspaceDependencies: freezeArray(value.allowedWorkspaceDependencies),
  allowedRuntimeDependencies: freezeArray([]),
  optionalPeerEntries: Object.freeze(
    Object.fromEntries(
      Object.entries(value.optionalPeerEntries).map(([name, selectors]) => [name, freezeArray(selectors)]),
    ),
  ),
  toolingEntries: freezeArray([]),
  release: 'lockstep',
});

export const PACKAGE_POLICY = Object.freeze({
  ${JSON.stringify(coreA.id)}: row({
    directory: ${JSON.stringify(coreA.directory)},
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    optionalPeerEntries: {},
  }),
  ${JSON.stringify(coreB.id)}: row({
    directory: ${JSON.stringify(coreB.directory)},
    zone: 'runtime',
    ring: 1,
    allowedWorkspaceDependencies: [${JSON.stringify(coreA.id)}],
    optionalPeerEntries: {},
  }),
  ${JSON.stringify(adapter.id)}: row({
    directory: ${JSON.stringify(adapter.directory)},
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: [${JSON.stringify(coreB.id)}],
    optionalPeerEntries: { ai: ['.'] },
  }),
});
`;
}

function compatibility(range: string, floor: string, tested: readonly string[], evidence: string): string {
  return `Object.freeze({
        range: ${JSON.stringify(range)},
        floor: ${JSON.stringify(floor)},
        tested: Object.freeze(${JSON.stringify(tested)}),
        evidence: ${JSON.stringify(evidence)},
      })`;
}

function releasePolicySource(fixture: ReleaseContractFixture, mutation?: Mutation): string {
  const { adapter, coreA, coreB } = fixture.packages;
  const { core, peerFloor, peerCurrent } = fixture.versions;
  const adapterGroup = mutation === 'duplicate-group' ? "Object.freeze(['core', 'integration'])" : "'integration'";
  const internalRange = mutation === 'prerelease' ? `^${core}` : core;
  const internalTested = [core];
  const rows = [`  ${JSON.stringify(coreA.id)}: row('core'),`, `  ${JSON.stringify(coreB.id)}: row('core'),`];
  rows.push(`  ${JSON.stringify(adapter.id)}: row(${adapterGroup}, {
    ${JSON.stringify(coreB.id)}: ${compatibility(internalRange, core, internalTested, 'fixtures/release/adapter-core')},
  }, {
    ai: ${compatibility(`^${peerFloor}`, peerFloor, [peerFloor, peerCurrent], 'fixtures/release/adapter-ai')},
  }),`);
  if (mutation === 'stale-policy') rows.push(`  ghost: row('integration'),`);
  return `const row = (group, internalCompatibility = {}, peers = {}) => Object.freeze({
  group,
  internalCompatibility: Object.freeze(internalCompatibility),
  peers: Object.freeze(peers),
});

export const RELEASE_PACKAGE_POLICY = Object.freeze({
${rows.join('\n')}
});
`;
}

function writePackage(root: string, identity: PackageIdentity, manifest: Readonly<Record<string, unknown>>): void {
  const directory = join(root, identity.directory);
  writeJson(join(directory, 'package.json'), manifest);
  mkdirSync(join(directory, 'src'));
  writeFileSync(
    join(directory, 'src', 'index.mjs'),
    `export const packageName = ${JSON.stringify(identity.npmName)};\n`,
  );
}

function writeReleaseFixture(root: string, mutation?: Mutation): void {
  const fixture = contract();
  const { adapter, coreA, coreB } = fixture.packages;
  const { core, integrationNext, peerFloor } = fixture.versions;
  mkdirSync(join(root, 'scripts', 'product'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'architecture'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'release'), { recursive: true });

  writeJson(join(root, 'package.json'), {
    name: 'release-contract-fixture',
    private: true,
    workspaces: ['packages/*'],
  });
  writeFileSync(join(root, 'scripts', 'product', 'catalog.mjs'), catalogSource(fixture));
  writeFileSync(join(root, 'scripts', 'architecture', 'policy.mjs'), architecturePolicySource(fixture));
  writeFileSync(join(root, 'scripts', 'release', 'policy.mjs'), releasePolicySource(fixture, mutation));
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    `# Changelog

## [Unreleased]

### Changed

- **product:** reserve release-contract fixture changes.

## [${core}] - 2026-09-06

### Added

- **product:** establish the release-contract fixture.
`,
  );

  writePackage(root, coreA, packageManifest(coreA, core));
  writePackage(
    root,
    coreB,
    packageManifest(coreB, mutation === 'core-drift' ? integrationNext : core, {
      dependencies: { [coreA.npmName]: 'workspace:^' },
    }),
  );
  const adapterPeerRange = mutation === 'internal-range' ? 'workspace:^' : core;
  writePackage(
    root,
    adapter,
    packageManifest(adapter, core, {
      devDependencies: {
        [coreB.npmName]: 'workspace:^',
        ai: peerFloor,
        ...(mutation === 'alias' ? { 'ai-unsupported-fixture': 'npm:ai@7.0.83' } : {}),
      },
      peerDependencies: {
        [coreB.npmName]: adapterPeerRange,
        ai: mutation === 'peer-floor' ? '^7.0.83' : `^${peerFloor}`,
      },
    }),
  );

  if (mutation === 'undeclared-dependency') {
    writeFileSync(
      join(root, adapter.directory, 'src', 'index.mjs'),
      "import 'fixture-undeclared';\nexport const packageName = '@fixture/adapter';\n",
    );
  }
  if (mutation === 'unclassified') {
    const identity = {
      id: 'unclassified',
      directory: 'packages/unclassified',
      npmName: '@fixture/unclassified',
    };
    writePackage(root, identity, packageManifest(identity, core));
  }
}

function withReleaseFixture<T>(mutation: Mutation | undefined, inspect: (root: string) => T): T {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-release-contract-'));
  const root = join(temporary, 'fixture');
  try {
    writeReleaseFixture(root, mutation);
    return inspect(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function withReleaseFixtureAsync<T>(
  mutation: Mutation | undefined,
  inspect: (root: string) => Promise<T>,
): Promise<T> {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-release-contract-'));
  const root = join(temporary, 'fixture');
  try {
    writeReleaseFixture(root, mutation);
    return await inspect(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function diagnosticLines(root: string): readonly string[] {
  return releaseGovernance.releaseGovernanceDiagnostics(root, undefined, false);
}

function npmEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment['NODE_PATH'];
  return {
    ...environment,
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    NO_COLOR: '1',
  };
}

function output(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function packFilename(result: SpawnSyncReturns<string>): string {
  if (result.status !== 0) throw new Error(`npm pack failed: ${output(result)}`);
  const report: unknown = JSON.parse(result.stdout);
  const row = Array.isArray(report) ? report[0] : isRecord(report) ? Object.values(report)[0] : undefined;
  if (!isRecord(row) || typeof row['filename'] !== 'string') {
    throw new Error(`npm pack returned no filename: ${result.stdout}`);
  }
  return row['filename'];
}

function writePeerFixture(
  directory: string,
  options: {
    readonly name: string;
    readonly peerName: string;
    readonly peerRange: string;
    readonly importName: string;
  },
): void {
  writeJson(join(directory, 'package.json'), {
    name: options.name,
    version: '1.0.0',
    private: false,
    type: 'module',
    files: ['index.mjs'],
    exports: './index.mjs',
    peerDependencies: { [options.peerName]: options.peerRange },
  });
  writeFileSync(
    join(directory, 'index.mjs'),
    `import { createRequire } from 'node:module';
import * as peer from ${JSON.stringify(options.importName)};

const require = createRequire(import.meta.url);
const manifest = require(${JSON.stringify(`${options.importName}/package.json`)});
export const observation = Object.freeze({
  keys: Object.keys(peer).toSorted(),
  version: manifest.version,
});
`,
  );
}

function runExactAiConsumer(version: string): PackageManagerOutcome {
  const observed = readJson<PackageManifest>(AI_VERCEL_MANIFEST);
  const peerRange = observed.peerDependencies?.['ai'];
  if (peerRange === undefined) throw new Error('@zmdb/ai-vercel does not declare peerDependencies.ai');

  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-release-ai-consumer-'));
  const adapter = join(temporary, 'adapter');
  const artifacts = join(temporary, 'artifacts');
  const consumer = join(temporary, 'consumer');
  const cache = join(temporary, 'npm-cache');
  let outcome: Omit<PackageManagerOutcome, 'cacheRemoved' | 'consumerRemoved'> | undefined;
  try {
    mkdirSync(adapter, { recursive: true });
    mkdirSync(artifacts);
    mkdirSync(consumer);
    writePeerFixture(adapter, {
      name: '@fixture/ai-vercel-peer-contract',
      peerName: 'ai',
      peerRange,
      importName: 'ai',
    });
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', artifacts], {
      cwd: adapter,
      encoding: 'utf8',
      env: npmEnvironment(),
    });
    const archive = join(artifacts, packFilename(packed));
    writeJson(join(consumer, 'package.json'), {
      name: 'release-ai-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@fixture/ai-vercel-peer-contract': `file:${archive}`,
        ai: version,
      },
    });
    const installed = spawnSync(
      'npm',
      [
        'install',
        '--strict-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--loglevel=error',
        '--cache',
        cache,
      ],
      {
        cwd: consumer,
        encoding: 'utf8',
        env: npmEnvironment(),
        timeout: PACKAGE_MANAGER_TIMEOUT_MS,
      },
    );
    const adapterPath = join(consumer, 'node_modules', '@fixture', 'ai-vercel-peer-contract');
    const peerPath = join(consumer, 'node_modules', 'ai');
    const runtime =
      installed.status === 0
        ? spawnSync(
            process.execPath,
            [
              '--input-type=module',
              '--eval',
              "import { observation } from '@fixture/ai-vercel-peer-contract'; process.stdout.write(JSON.stringify(observation));",
            ],
            {
              cwd: consumer,
              encoding: 'utf8',
              env: npmEnvironment(),
            },
          )
        : { status: null, stdout: '', stderr: '' };
    outcome = {
      status: installed.status,
      stdout: installed.stdout,
      stderr: installed.stderr,
      runtimeStatus: runtime.status,
      runtimeStdout: runtime.stdout,
      ...(existsSync(peerPath)
        ? { installedPeerVersion: readJson<PackageManifest>(join(peerPath, 'package.json')).version }
        : {}),
      installedPeerRange: peerRange,
      adapterInsideConsumer: existsSync(adapterPath) && isInside(consumer, realpathSync(adapterPath)),
      peerInsideConsumer: existsSync(peerPath) && isInside(consumer, realpathSync(peerPath)),
      rootDevDependencyPresent: existsSync(join(consumer, 'node_modules', 'vitest')),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (outcome === undefined) throw new Error('exact AI consumer produced no outcome');
  return {
    ...outcome,
    consumerRemoved: !existsSync(consumer),
    cacheRemoved: !existsSync(cache),
  };
}

function packLocalPackage(directory: string, destination: string): string {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', destination], {
    cwd: directory,
    encoding: 'utf8',
    env: npmEnvironment(),
  });
  return join(destination, packFilename(packed));
}

function runCoreConsumer(version: string): PackageManagerOutcome {
  const fixture = contract();
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-release-core-consumer-'));
  const core = join(temporary, 'core');
  const adapter = join(temporary, 'adapter');
  const artifacts = join(temporary, 'artifacts');
  const consumer = join(temporary, 'consumer');
  const cache = join(temporary, 'npm-cache');
  let outcome: Omit<PackageManagerOutcome, 'cacheRemoved' | 'consumerRemoved'> | undefined;
  try {
    mkdirSync(core);
    mkdirSync(adapter);
    mkdirSync(artifacts);
    mkdirSync(consumer);
    writeJson(join(core, 'package.json'), {
      name: '@fixture/release-core',
      version,
      private: false,
      type: 'module',
      files: ['index.mjs'],
      exports: {
        '.': './index.mjs',
        './package.json': './package.json',
      },
    });
    writeFileSync(join(core, 'index.mjs'), `export const version = ${JSON.stringify(version)};\n`);
    writePeerFixture(adapter, {
      name: '@fixture/release-adapter',
      peerName: '@fixture/release-core',
      peerRange: fixture.versions.core,
      importName: '@fixture/release-core',
    });
    const coreArchive = packLocalPackage(core, artifacts);
    const adapterArchive = packLocalPackage(adapter, artifacts);
    writeJson(join(consumer, 'package.json'), {
      name: 'release-core-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@fixture/release-adapter': `file:${adapterArchive}`,
        '@fixture/release-core': `file:${coreArchive}`,
      },
    });
    const installed = spawnSync(
      'npm',
      [
        'install',
        '--strict-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--loglevel=error',
        '--cache',
        cache,
      ],
      {
        cwd: consumer,
        encoding: 'utf8',
        env: npmEnvironment(),
        timeout: PACKAGE_MANAGER_TIMEOUT_MS,
      },
    );
    const adapterPath = join(consumer, 'node_modules', '@fixture', 'release-adapter');
    const peerPath = join(consumer, 'node_modules', '@fixture', 'release-core');
    const runtime =
      installed.status === 0
        ? spawnSync(
            process.execPath,
            [
              '--input-type=module',
              '--eval',
              "import { observation } from '@fixture/release-adapter'; process.stdout.write(JSON.stringify(observation));",
            ],
            {
              cwd: consumer,
              encoding: 'utf8',
              env: npmEnvironment(),
            },
          )
        : { status: null, stdout: '', stderr: '' };
    outcome = {
      status: installed.status,
      stdout: installed.stdout,
      stderr: installed.stderr,
      runtimeStatus: runtime.status,
      runtimeStdout: runtime.stdout,
      ...(existsSync(peerPath)
        ? { installedPeerVersion: readJson<PackageManifest>(join(peerPath, 'package.json')).version }
        : {}),
      installedPeerRange: fixture.versions.core,
      adapterInsideConsumer: existsSync(adapterPath) && isInside(consumer, realpathSync(adapterPath)),
      peerInsideConsumer: existsSync(peerPath) && isInside(consumer, realpathSync(peerPath)),
      rootDevDependencyPresent: existsSync(join(consumer, 'node_modules', 'vitest')),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (outcome === undefined) throw new Error('core consumer produced no outcome');
  return {
    ...outcome,
    consumerRemoved: !existsSync(consumer),
    cacheRemoved: !existsSync(cache),
  };
}

function runUndeclaredConsumer(): PackageManagerOutcome {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-release-undeclared-consumer-'));
  const adapter = join(temporary, 'adapter');
  const artifacts = join(temporary, 'artifacts');
  const consumer = join(temporary, 'consumer');
  const cache = join(temporary, 'npm-cache');
  let outcome: Omit<PackageManagerOutcome, 'cacheRemoved' | 'consumerRemoved'> | undefined;
  try {
    mkdirSync(adapter);
    mkdirSync(artifacts);
    mkdirSync(consumer);
    writeJson(join(adapter, 'package.json'), {
      name: '@fixture/undeclared-adapter',
      version: '1.0.0',
      private: false,
      type: 'module',
      files: ['index.mjs'],
      exports: './index.mjs',
    });
    writeFileSync(join(adapter, 'index.mjs'), "import 'fixture-undeclared';\nexport const loaded = true;\n");
    const archive = packLocalPackage(adapter, artifacts);
    writeJson(join(consumer, 'package.json'), {
      name: 'release-undeclared-consumer',
      private: true,
      type: 'module',
      dependencies: { '@fixture/undeclared-adapter': `file:${archive}` },
    });
    const installed = spawnSync(
      'npm',
      [
        'install',
        '--strict-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--loglevel=error',
        '--cache',
        cache,
      ],
      {
        cwd: consumer,
        encoding: 'utf8',
        env: npmEnvironment(),
        timeout: PACKAGE_MANAGER_TIMEOUT_MS,
      },
    );
    const adapterPath = join(consumer, 'node_modules', '@fixture', 'undeclared-adapter');
    const runtime =
      installed.status === 0
        ? spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', "await import('@fixture/undeclared-adapter');"],
            {
              cwd: consumer,
              encoding: 'utf8',
              env: npmEnvironment(),
            },
          )
        : { status: null, stdout: '', stderr: '' };
    outcome = {
      status: installed.status,
      stdout: installed.stdout,
      stderr: installed.stderr,
      runtimeStatus: runtime.status,
      runtimeStdout: `${runtime.stdout}\n${runtime.stderr}`.trim(),
      adapterInsideConsumer: existsSync(adapterPath) && isInside(consumer, realpathSync(adapterPath)),
      peerInsideConsumer: false,
      rootDevDependencyPresent: existsSync(join(consumer, 'node_modules', 'vitest')),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (outcome === undefined) throw new Error('undeclared consumer produced no outcome');
  return {
    ...outcome,
    consumerRemoved: !existsSync(consumer),
    cacheRemoved: !existsSync(cache),
  };
}

describe('release groups and compatibility tests freeze (#747)', () => {
  it('keeps the release fixture exhaustive, parseable and green before isolated mutations', async () => {
    const fixture = contract();
    expect(fixture.diagnosticCases.map(testCase => testCase.mutation).toSorted()).toEqual([
      'alias',
      'core-drift',
      'duplicate-group',
      'internal-range',
      'peer-floor',
      'prerelease',
      'stale-policy',
      'unclassified',
      'undeclared-dependency',
    ]);
    expect(new Set(fixture.diagnosticCases.map(testCase => testCase.expected)).size).toBe(
      fixture.diagnosticCases.length,
    );
    await withReleaseFixtureAsync(undefined, async root => {
      expect(diagnosticLines(root)).toEqual([]);
      const releaseModule: unknown = await import(
        `${pathToFileURL(join(root, 'scripts', 'release', 'policy.mjs')).href}?fixture=747`
      );
      expect(isRecord(releaseModule)).toBe(true);
      const policy = isRecord(releaseModule) ? releaseModule['RELEASE_PACKAGE_POLICY'] : undefined;
      expect(isRecord(policy)).toBe(true);
      expect(Object.keys(isRecord(policy) ? policy : {}).toSorted()).toEqual(['adapter', 'core-a', 'core-b']);
    });
  });

  // Measured at ee4e496a: the current lockstep verifier returns [] for every case except core drift,
  // where it reports RELEASE_VERSION_DRIFT. It does not read the frozen release policy yet.
  it.fails.each(contract().diagnosticCases)('$name reports the exact actionable correction', testCase => {
    withReleaseFixture(testCase.mutation, root => {
      expect(diagnosticLines(root)).toContain(testCase.expected);
    });
  });

  // Measured at ee4e496a: releasePlan ignores the target and returns all three fixture packages
  // at 1.0.0-alpha.4 with no manifestChanges field.
  it.fails('releases one integration without moving either core package', () => {
    const fixture = contract();
    withReleaseFixture(undefined, root => {
      const targetPlan = releasePlan as unknown as (
        root: string,
        target: { readonly kind: 'package'; readonly id: string; readonly version: string },
      ) => ReleaseTargetPlan;
      const plan = targetPlan(root, {
        kind: 'package',
        id: fixture.packages.adapter.id,
        version: fixture.versions.integrationNext,
      });
      expect(plan).toMatchObject({
        releaseId: fixture.packages.adapter.id,
        version: fixture.versions.integrationNext,
        packages: [fixture.packages.adapter.npmName],
      });
      expect(plan.manifestChanges).toEqual([
        {
          package: fixture.packages.adapter.npmName,
          version: fixture.versions.integrationNext,
          ranges: {},
        },
      ]);
    });
  });

  it(
    'installs the exact supported AI floor/current version from an isolated generated manifest',
    { timeout: PACKAGE_MANAGER_TIMEOUT_MS },
    () => {
      const fixture = contract();
      expect(fixture.versions.peerCurrent).toBe(fixture.versions.peerFloor);
      const outcome = runExactAiConsumer(fixture.versions.peerFloor);
      expect(outcome.status, outcome.stderr || outcome.stdout).toBe(0);
      expect(outcome.runtimeStatus, outcome.runtimeStdout).toBe(0);
      expect(JSON.parse(outcome.runtimeStdout)).toMatchObject({ version: fixture.versions.peerFloor });
      expect(outcome).toMatchObject({
        installedPeerVersion: fixture.versions.peerFloor,
        adapterInsideConsumer: true,
        peerInsideConsumer: true,
        rootDevDependencyPresent: false,
        consumerRemoved: true,
        cacheRemoved: true,
      });
    },
  );

  it('rejects the exact real AI version below the supported floor', { timeout: PACKAGE_MANAGER_TIMEOUT_MS }, () => {
    const outcome = runExactAiConsumer(contract().versions.peerBelowFloor);
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain('ERESOLVE');
    expect(outcome.consumerRemoved).toBe(true);
    expect(outcome.cacheRemoved).toBe(true);
  });

  it(
    'uses package-manager prerelease semantics for matching and mismatched core tarballs',
    { timeout: PACKAGE_MANAGER_TIMEOUT_MS },
    () => {
      const fixture = contract();
      const supported = runCoreConsumer(fixture.versions.core);
      expect(supported.status, supported.stderr || supported.stdout).toBe(0);
      expect(supported.runtimeStatus, supported.runtimeStdout).toBe(0);
      expect(JSON.parse(supported.runtimeStdout)).toMatchObject({ version: fixture.versions.core });
      expect(supported).toMatchObject({
        installedPeerVersion: fixture.versions.core,
        adapterInsideConsumer: true,
        peerInsideConsumer: true,
        rootDevDependencyPresent: false,
        consumerRemoved: true,
        cacheRemoved: true,
      });

      const mismatched = runCoreConsumer(fixture.versions.integrationNext);
      expect(mismatched.status).not.toBe(0);
      expect(mismatched.stderr).toContain('ERESOLVE');
      expect(mismatched.consumerRemoved).toBe(true);
      expect(mismatched.cacheRemoved).toBe(true);
    },
  );

  it(
    'proves the undeclared-import fixture fails only after isolated installation',
    { timeout: PACKAGE_MANAGER_TIMEOUT_MS },
    () => {
      const outcome = runUndeclaredConsumer();
      expect(outcome.status, outcome.stderr || outcome.stdout).toBe(0);
      expect(outcome.runtimeStatus).not.toBe(0);
      expect(outcome.runtimeStdout).toContain('ERR_MODULE_NOT_FOUND');
      expect(outcome.runtimeStdout).toContain('fixture-undeclared');
      expect(outcome).toMatchObject({
        adapterInsideConsumer: true,
        rootDevDependencyPresent: false,
        consumerRemoved: true,
        cacheRemoved: true,
      });
    },
  );
});
