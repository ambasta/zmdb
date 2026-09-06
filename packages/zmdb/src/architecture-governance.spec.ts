import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createImportGraph } from '../../../.github/scripts/lib/import-graph.mjs';
import { loadGovernanceSnapshot } from '../../../scripts/architecture/governance.mjs';
import {
  createDependencyGraph,
  loadArchitecture,
  loadArchitectureSync,
  lookupExport,
  lookupPackage,
  policyMembershipDiagnostics,
  topologicalOrder,
} from '../../../scripts/architecture/index.mjs';
import type { PackagePolicy } from '../../../scripts/architecture/policy.mjs';
import { PRODUCT_CATALOG } from '../../../scripts/product/catalog.mjs';
import { releasePlan } from '../../../scripts/release/plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'scripts', 'architecture', '__fixtures__');
const BUMP = join(ROOT, 'scripts', 'release', 'bump.mjs');

const VERIFIERS = {
  architecture: join(ROOT, '.github', 'scripts', 'verify-architecture-zones.mjs'),
  metadata: join(ROOT, '.github', 'scripts', 'verify-package-metadata.mjs'),
  release: join(ROOT, '.github', 'scripts', 'verify-release-governance.mjs'),
  runtime: join(ROOT, '.github', 'scripts', 'verify-runtime-reachability.mjs'),
} as const;

const FIXTURE_NAMES = [
  'valid',
  'cycle',
  'upward-edge',
  'undeclared-package',
  'tooling-leak',
  'peer-leak',
  'metadata-drift',
  'version-drift',
  'changelog-drift',
] as const;

type FixtureName = (typeof FIXTURE_NAMES)[number];
type InvalidFixtureName = Exclude<FixtureName, 'valid'>;

const EXPECTED_MUTATIONS: Readonly<Record<InvalidFixtureName, readonly string[]>> = {
  'changelog-drift': ['CHANGELOG.md'],
  cycle: [
    'packages/app/src/index.ts',
    'packages/core/package.json',
    'packages/core/src/index.ts',
    'scripts/architecture/policy.mjs',
  ],
  'metadata-drift': ['packages/app/package.json'],
  'peer-leak': ['packages/app/src/index.ts'],
  'tooling-leak': ['packages/app/src/index.ts'],
  'undeclared-package': ['scripts/architecture/policy.mjs'],
  'upward-edge': [
    'packages/app/package.json',
    'packages/app/src/index.ts',
    'packages/core/package.json',
    'packages/core/src/index.ts',
    'scripts/architecture/policy.mjs',
  ],
  'version-drift': ['packages/core/package.json'],
};

interface ProductPackageFixture {
  readonly id: string;
  readonly directory: string;
  readonly npmName: string;
}

interface PackageManifestFixture {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

interface VerifierResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function fixtureRoot(name: FixtureName): string {
  return join(FIXTURES, name);
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function fixtureFiles(root: string): readonly string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`${relative(root, path)} is a symlink; fixtures must not escape their root`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) found.push(relative(root, path));
    }
  };
  visit(root);
  return found.toSorted();
}

function fixtureContents(root: string): ReadonlyMap<string, string> {
  return new Map(fixtureFiles(root).map(path => [path, readFileSync(join(root, path), 'utf8')]));
}

function importedSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
  }
  return specifiers;
}

function assertSourceImportsStayInside(root: string, file: string): void {
  const source = readFileSync(file, 'utf8');
  expect(source, relative(root, file)).not.toContain(ROOT);
  expect(source, relative(root, file)).not.toContain('node_modules');

  for (const specifier of importedSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;
    expect(specifier, `${relative(root, file)} relative import`).not.toMatch(/\.ts$/);
    expect(specifier, `${relative(root, file)} relative import`).toMatch(/\.js$/);
    const emittedPath = resolve(dirname(file), specifier);
    const sourcePath = emittedPath.endsWith('.js') ? `${emittedPath.slice(0, -'.js'.length)}.ts` : emittedPath;
    expect(isInside(root, sourcePath), `${relative(root, file)} -> ${specifier}`).toBe(true);
    expect(existsSync(sourcePath), `${relative(root, file)} -> ${specifier}`).toBe(true);
  }
}

async function fixtureModules(root: string): Promise<{
  readonly catalog: readonly ProductPackageFixture[];
  readonly policy: Readonly<Record<string, PackagePolicy>>;
}> {
  const catalogModule: unknown = await import(
    `${pathToFileURL(join(root, 'scripts', 'product', 'catalog.mjs')).href}?root=${encodeURIComponent(root)}`
  );
  const policyModule: unknown = await import(
    `${pathToFileURL(join(root, 'scripts', 'architecture', 'policy.mjs')).href}?root=${encodeURIComponent(root)}`
  );
  if (!isRecord(catalogModule) || !Array.isArray(catalogModule['PRODUCT_CATALOG'])) {
    throw new Error(`${relative(ROOT, root)} does not export PRODUCT_CATALOG`);
  }
  if (!isRecord(policyModule) || !isRecord(policyModule['PACKAGE_POLICY'])) {
    throw new Error(`${relative(ROOT, root)} does not export PACKAGE_POLICY`);
  }
  return {
    catalog: catalogModule['PRODUCT_CATALOG'] as readonly ProductPackageFixture[],
    policy: policyModule['PACKAGE_POLICY'] as Readonly<Record<string, PackagePolicy>>,
  };
}

async function assertFixtureSkeleton(name: FixtureName): Promise<void> {
  const root = fixtureRoot(name);
  const files = fixtureFiles(root);
  expect(files).toContain('package.json');
  expect(files).toContain('tsconfig.json');
  expect(files).toContain('CHANGELOG.md');
  expect(files).toContain('scripts/product/catalog.mjs');
  expect(files).toContain('scripts/architecture/policy.mjs');

  const rootManifest = readJson<{ readonly private?: boolean; readonly workspaces?: readonly string[] }>(
    join(root, 'package.json'),
  );
  expect(rootManifest.private).toBe(true);
  expect(rootManifest.workspaces).toEqual(['packages/*']);

  const rootConfig = readJson<{ readonly compilerOptions?: { readonly allowImportingTsExtensions?: boolean } }>(
    join(root, 'tsconfig.json'),
  );
  expect(rootConfig.compilerOptions?.allowImportingTsExtensions).toBe(false);

  for (const file of files) {
    const absolute = join(root, file);
    if (file.endsWith('.json')) readJson<unknown>(absolute);
    if (file.endsWith('.ts') || file.endsWith('.mjs')) assertSourceImportsStayInside(root, absolute);
  }

  const { catalog, policy } = await fixtureModules(root);
  expect(catalog.map(row => row.id)).toEqual(['core', 'app']);
  expect(Object.keys(policy).toSorted()).toEqual(name === 'undeclared-package' ? ['core'] : ['app', 'core']);

  for (const row of catalog) {
    const packageDirectory = resolve(root, row.directory);
    expect(isInside(root, packageDirectory), `${name}:${row.id} directory`).toBe(true);
    for (const required of [
      'package.json',
      'README.md',
      'LICENSE',
      'SPEC.md',
      'tsconfig.json',
      'tsconfig.build.json',
    ]) {
      expect(existsSync(join(packageDirectory, required)), `${name}:${row.id}/${required}`).toBe(true);
    }

    const manifest = readJson<PackageManifestFixture>(join(packageDirectory, 'package.json'));
    expect(manifest.name, `${name}:${row.id} npm name`).toBe(row.npmName);
    expect(isRecord(manifest.exports), `${name}:${row.id} exports`).toBe(true);
    for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
      expect(typeof target, `${name}:${row.id}#${entry}`).toBe('string');
      if (typeof target !== 'string') continue;
      const exportTarget = resolve(packageDirectory, target);
      expect(isInside(packageDirectory, exportTarget), `${name}:${row.id}#${entry}`).toBe(true);
      expect(existsSync(exportTarget), `${name}:${row.id}#${entry}`).toBe(true);
    }
  }
}

function runVerifier(script: string, root: string, ...args: readonly string[]): VerifierResult {
  const result = spawnSync(process.execPath, [script, '--root', root, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function diagnosticLines(result: VerifierResult): readonly string[] {
  return result.stderr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('['));
}

function withValidFixtureCopy<T>(mutate: (root: string) => void, inspect: (root: string) => T): T {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-architecture-'));
  const root = join(temporary, 'fixture');
  cpSync(fixtureRoot('valid'), root, { recursive: true });
  try {
    mutate(root);
    return inspect(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

function fakeYarn(root: string): { readonly bin: string; readonly log: string } {
  const bin = join(root, 'fake-bin');
  const log = join(root, 'fake-yarn.log');
  mkdirSync(bin);
  const executable = join(bin, 'yarn');
  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" > "$FAKE_YARN_LOG"
printf 'updated-by-fake-yarn\\n' > yarn.lock
exit "$FAKE_YARN_EXIT"
`,
  );
  chmodSync(executable, 0o755);
  return { bin, log };
}

function runBump(root: string, version: string, exitCode = 0): VerifierResult {
  const fake = fakeYarn(root);
  const result = spawnSync(process.execPath, [BUMP, version, '--root', root, '--date', '2026-09-06'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_YARN_EXIT: String(exitCode),
      FAKE_YARN_LOG: fake.log,
      PATH: `${fake.bin}:${process.env['PATH'] ?? ''}`,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('architecture and release governance fixtures', () => {
  it('keeps every fixture self-contained and limited to its named mutation', async () => {
    for (const name of FIXTURE_NAMES) await assertFixtureSkeleton(name);

    const valid = fixtureContents(fixtureRoot('valid'));
    for (const name of FIXTURE_NAMES) {
      if (name === 'valid') continue;
      const candidate = fixtureContents(fixtureRoot(name));
      expect([...candidate.keys()], `${name} file inventory`).toEqual([...valid.keys()]);
      const changed = [...valid.keys()].filter(path => valid.get(path) !== candidate.get(path));
      expect(changed, `${name} mutations`).toEqual(EXPECTED_MUTATIONS[name]);
    }
  });

  it('accepts the canonical package graph fixture', async () => {
    const root = fixtureRoot('valid');
    const architecture = await loadArchitecture(root);
    const synchronous = loadArchitectureSync(root);
    const live = await loadArchitecture(ROOT);

    const liveIds = live.packages.map(packageRecord => packageRecord.id);
    expect(liveIds).toEqual(PRODUCT_CATALOG.map(row => row.id));
    expect(Object.keys(createDependencyGraph(live))).toEqual(liveIds);

    const langchain = lookupPackage(live, '@zmdb/ai-langchain');
    if (langchain === undefined) throw new Error('canonical catalog omitted @zmdb/ai-langchain');
    expect(langchain.policy.allowedWorkspaceDependencies).toEqual(['ai']);
    expect(lookupPackage(live, langchain.directory)).toBe(langchain);

    const react = lookupPackage(live, 'react');
    if (react === undefined) throw new Error('canonical catalog omitted the react package id');
    expect(react.npmName).toBe('@zmdb/react');
    expect(lookupExport(live, 'react')).toBeUndefined();
    expect(lookupExport(live, '@zmdb/react')).toMatchObject({
      package: { id: 'react', npmName: '@zmdb/react' },
      selector: '.',
      target: './src/index.ts',
    });

    const reactNative = lookupPackage(live, '@zmdb/react-native');
    if (reactNative === undefined) throw new Error('canonical catalog omitted @zmdb/react-native');
    expect(reactNative.policy.allowedWorkspaceDependencies).toEqual(['client', 'react']);
    expect(lookupExport(live, '@zmdb/react-native')).toMatchObject({
      package: { id: 'react-native', npmName: '@zmdb/react-native' },
      selector: '.',
      target: './src/index.ts',
    });

    const vue = lookupPackage(live, 'vue');
    if (vue === undefined) throw new Error('canonical catalog omitted the vue package id');
    expect(vue.npmName).toBe('@zmdb/vue');
    expect(lookupExport(live, 'vue')).toBeUndefined();
    expect(lookupExport(live, '@zmdb/vue')).toMatchObject({
      package: { id: 'vue', npmName: '@zmdb/vue' },
      selector: '.',
      target: './src/index.ts',
    });

    const next = lookupPackage(live, 'next');
    if (next === undefined) throw new Error('canonical catalog omitted the Next package id');
    expect(next.policy.allowedWorkspaceDependencies).toEqual(['client', 'react']);
    expect(lookupExport(live, '@zmdb/next/client')).toMatchObject({
      package: { id: 'next', npmName: '@zmdb/next' },
      selector: './client',
      target: './src/client.ts',
    });
    expect(lookupExport(live, '@zmdb/next/server')).toMatchObject({
      package: { id: 'next', npmName: '@zmdb/next' },
      selector: './server',
      target: './src/server.ts',
    });

    const nuxt = lookupPackage(live, 'nuxt');
    if (nuxt === undefined) throw new Error('canonical catalog omitted the nuxt package id');
    expect(nuxt.npmName).toBe('@zmdb/nuxt');
    expect(nuxt.policy.allowedWorkspaceDependencies).toEqual(['client', 'vue']);
    expect(lookupExport(live, 'nuxt')).toBeUndefined();
    expect(lookupExport(live, '@zmdb/nuxt')).toMatchObject({
      package: { id: 'nuxt', npmName: '@zmdb/nuxt' },
      selector: '.',
      target: './src/index.ts',
    });
    expect(lookupExport(live, '@zmdb/nuxt/client')).toMatchObject({
      package: { id: 'nuxt', npmName: '@zmdb/nuxt' },
      selector: './client',
      target: './src/client/index.ts',
    });
    expect(lookupExport(live, '@zmdb/nuxt/server')).toMatchObject({
      package: { id: 'nuxt', npmName: '@zmdb/nuxt' },
      selector: './server',
      target: './src/server/index.ts',
    });

    const solid = lookupPackage(live, 'solid');
    if (solid === undefined) throw new Error('canonical catalog omitted the solid package id');
    expect(solid.npmName).toBe('@zmdb/solid');
    expect(lookupExport(live, 'solid')).toBeUndefined();
    expect(lookupExport(live, '@zmdb/solid')).toMatchObject({
      package: { id: 'solid', npmName: '@zmdb/solid' },
      selector: '.',
      target: './src/index.ts',
    });

    expect(architecture.packages.map(packageRecord => packageRecord.id)).toEqual(['core', 'app']);
    expect(synchronous.packages.map(packageRecord => packageRecord.id)).toEqual(['core', 'app']);
    expect(createDependencyGraph(architecture)).toEqual({
      core: [],
      app: ['core'],
    });
    expect(lookupExport(architecture, '@fixture/app/cli')).toMatchObject({
      package: { id: 'app', npmName: '@fixture/app' },
      selector: './cli',
      target: './src/cli.ts',
      path: join(root, 'packages', 'app', 'src', 'cli.ts'),
    });
    expect(Object.isFrozen(architecture.packages)).toBe(true);
    expect(Object.isFrozen(architecture.policy)).toBe(true);

    const importGraph = createImportGraph(root, architecture.packages);
    expect(
      importGraph
        .importsOf(
          join(root, 'packages', 'app', 'src', 'parser-probe.ts'),
          `
            // import { fake } from 'comment-only';
            const text = "export { fake } from 'string-only'";
            const template = \`import { fake } from 'template-only'\`;
            const pattern = /import .* from ['"]regex-only['"]/;
            import type { coreValue } from '@fixture/core';
            export { cliValue } from '@fixture/app/cli';
            const runtime = import('fixture-runtime');
            import 'fixture-tool';
          `,
        )
        .map(reference => reference.specifier),
    ).toEqual(['@fixture/core', '@fixture/app/cli', 'fixture-runtime', 'fixture-tool']);

    const fixtureResult = runVerifier(VERIFIERS.architecture, root);
    expect(fixtureResult).toMatchObject({ status: 0, stderr: '' });
    expect(fixtureResult.stdout.trim()).toBe(
      'architecture zones: 2 catalog packages, 1 workspace edges, and canonical rings verified.',
    );

    const liveResult = runVerifier(VERIFIERS.architecture, ROOT);
    expect(liveResult).toMatchObject({ status: 0, stderr: '' });
    expect(liveResult.stdout.trim()).toBe(
      'architecture zones: 38 catalog packages, 74 workspace edges, and canonical rings verified.',
    );
  });

  it('rejects a workspace dependency cycle and prints the complete cycle', () => {
    const result = runVerifier(VERIFIERS.architecture, fixtureRoot('cycle'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[ARCH_CYCLE] core -> app -> core: workspace dependency graph contains the complete shortest cycle core -> app -> core. Remediation: remove or reverse an ownership edge; do not raise rings.',
    ]);
  });

  it('rejects an edge not named by the consumer policy', () => {
    const result = runVerifier(VERIFIERS.architecture, fixtureRoot('upward-edge'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[ARCH_EDGE_FORBIDDEN] core -> app at packages/core/src/index.ts: @fixture/core imports @fixture/app, but app is absent from core.allowedWorkspaceDependencies. Remediation: use an existing inward public contract or review manifest and policy together.',
      '[ARCH_ZONE_DIRECTION] core (foundation) -> app (application): @fixture/core depends on an outward zone. Remediation: move ownership inward or introduce an explicit lower-layer contract.',
    ]);
  });

  it('rejects stale policy edges', () => {
    const stale = withValidFixtureCopy(
      root => {
        writeFileSync(
          join(root, 'packages', 'app', 'src', 'index.ts'),
          "import { runtimeValue } from 'fixture-runtime';\n\nexport const appValue = runtimeValue;\n",
        );
      },
      root => runVerifier(VERIFIERS.architecture, root),
    );
    expect(stale.status).toBe(1);
    expect(diagnosticLines(stale)).toEqual([
      '[ARCH_EDGE_STALE] app -> core: packages/app/package.json and app.allowedWorkspaceDependencies name @fixture/core, but no production export or executable imports it. Remediation: remove the stale edge from both authorities.',
    ]);

    const invalidRing = withValidFixtureCopy(
      root => {
        const path = join(root, 'scripts', 'architecture', 'policy.mjs');
        const source = readFileSync(path, 'utf8');
        const row = "directory: 'packages/app',\n    zone: 'application',\n    ring: 1,";
        expect(source).toContain(row);
        writeFileSync(path, source.replace(row, row.replace('ring: 1', 'ring: 2')));
      },
      root => runVerifier(VERIFIERS.architecture, root),
    );
    expect(invalidRing.status).toBe(1);
    expect(diagnosticLines(invalidRing)).toEqual([
      '[ARCH_RING_INVALID] app: declared ring 2 disagrees with canonical ring 1 from dependencies [core]. Remediation: set the canonical ring after fixing all edges.',
    ]);

    const privateImport = withValidFixtureCopy(
      root => {
        writeFileSync(
          join(root, 'packages', 'app', 'src', 'index.ts'),
          "import { runtimeValue } from 'fixture-runtime';\nimport { coreValue } from '../../core/src/index.js';\n\nexport const appValue = `${coreValue}:${runtimeValue}`;\n",
        );
      },
      root => runVerifier(VERIFIERS.architecture, root),
    );
    expect(privateImport.status).toBe(1);
    expect(diagnosticLines(privateImport)).toEqual([
      "[ARCH_PRIVATE_IMPORT] app -> core at packages/app/src/index.ts: @fixture/app imports private cross-package path ../../core/src/index.js. Remediation: publish/use the owning package's public export.",
    ]);
  });

  it('rejects a publishable package missing from policy', async () => {
    const missing =
      '[ARCH_POLICY_MISSING] app (@fixture/app): catalog package packages/app has no PACKAGE_POLICY row. Remediation: add the row under that catalog id.';
    await expect(loadArchitecture(fixtureRoot('undeclared-package'))).rejects.toMatchObject({
      name: 'ArchitecturePolicyError',
      diagnostics: [missing],
      message: missing,
    });

    const { catalog, policy } = await fixtureModules(fixtureRoot('valid'));
    const core = policy['core'];
    if (core === undefined) throw new Error('valid fixture omitted the core policy row');
    expect(policyMembershipDiagnostics(catalog, Object.freeze({ ...policy, retired: core }))).toEqual([
      '[ARCH_POLICY_STALE] retired: PACKAGE_POLICY row has no product-catalog member. Remediation: delete it or admit the package in the catalog in the same change.',
    ]);
  });

  // #725 retires the cycle, forbidden-edge and missing-manifest expected failures.
  // #726 retires the runtime reachability failures and adds stale-exemption coverage.
  // #727 retires metadata and version drift and adds optional-peer metadata coverage.
  // #728 retires the release failures and adds deterministic planning and bump rollback.
  it('rejects a runtime export reaching a tooling module', () => {
    const result = runVerifier(VERIFIERS.runtime, fixtureRoot('tooling-leak'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[ARCH_TOOLING_LEAK] @fixture/app#. via packages/app/src/index.ts -> fixture-tool: runtime export reaches the tooling-only dependency fixture-tool. Remediation: move the sink behind a tooling entry or split the tool owner.',
    ]);
  });

  it('rejects an optional peer reachable from an unassigned export', () => {
    const result = runVerifier(VERIFIERS.runtime, fixtureRoot('peer-leak'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[ARCH_PEER_LEAK] fixture-peer from @fixture/app#. via packages/app/src/index.ts -> fixture-peer: optional peer is reachable from an export not assigned in optionalPeerEntries. Remediation: route through an assigned integration entry or move it to an integration package.',
    ]);
  });

  it('rejects a dependency absent from the manifest', () => {
    const result = withValidFixtureCopy(
      root => {
        const path = join(root, 'packages', 'app', 'package.json');
        const manifest = readJson<{ dependencies: Record<string, string> }>(path);
        delete manifest.dependencies['@fixture/core'];
        writeJson(path, manifest);
      },
      root => runVerifier(VERIFIERS.architecture, root),
    );
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[ARCH_EDGE_UNDECLARED] app -> core at packages/app/src/index.ts: @fixture/app imports @fixture/core, but packages/app/package.json has no non-dev dependency on @fixture/core. Remediation: add the intended direct dependency and policy id, or remove the import.',
    ]);
  });

  it('rejects a stale tooling or peer exemption', () => {
    const result = runVerifier(VERIFIERS.runtime, ROOT, '--self-test');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('runtime reachability self-test: 10 case(s) passed.');
    expect(result.stderr).toBe('');
  });

  it('rejects incomplete or inconsistent package metadata', () => {
    const result = runVerifier(VERIFIERS.metadata, fixtureRoot('metadata-drift'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[PACKAGE_METADATA_INVALID] @fixture/app field dependencies.fixture-runtime: measured value is missing while an ordinary runtime entry and policy allowance use fixture-runtime. Remediation: restore the exact schema value or required file.',
    ]);
  });

  it('rejects versions that differ across the lockstep train', () => {
    const result = runVerifier(VERIFIERS.metadata, fixtureRoot('version-drift'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[PACKAGE_VERSION_DRIFT] lockstep train versions 1.0.0-alpha.3 (core), 1.0.0-alpha.4 (app): catalog packages do not share one version. Remediation: run one whole-train bump.',
    ]);
  });

  it('rejects an optional peer without optional metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'zmdb-package-metadata-'));
    try {
      cpSync(fixtureRoot('valid'), root, { recursive: true });
      const manifestPath = join(root, 'packages', 'app', 'package.json');
      const manifest = readJson<Readonly<Record<string, unknown>>>(manifestPath);
      const metadata = manifest['peerDependenciesMeta'];
      if (!isRecord(metadata)) throw new Error('valid fixture omitted peerDependenciesMeta');
      const { ['fixture-peer']: _fixturePeer, ...remainingMetadata } = metadata;
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...manifest, peerDependenciesMeta: remainingMetadata }, null, 2)}\n`,
      );

      const result = runVerifier(VERIFIERS.metadata, root);
      expect(result.status).toBe(1);
      expect(diagnosticLines(result)).toEqual([
        '[PACKAGE_PEER_METADATA] @fixture/app peer fixture-peer: peerDependenciesMeta.fixture-peer.optional is missing. Remediation: align the declaration and prove the range with the real peer.',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a release version absent from CHANGELOG.md', () => {
    const result = runVerifier(VERIFIERS.release, fixtureRoot('changelog-drift'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[RELEASE_CHANGELOG_MISSING] 1.0.0-alpha.4 at CHANGELOG.md: no unique non-empty version section exists. Remediation: add one non-empty exact version section.',
    ]);
  });

  it('rejects a tag that disagrees with package versions', () => {
    const result = runVerifier(VERIFIERS.release, fixtureRoot('valid'), '--tag', 'v1.0.0-alpha.5');
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[RELEASE_TAG_MISMATCH] v1.0.0-alpha.5 against 1.0.0-alpha.4: triggering tag disagrees with the common package version. Remediation: tag the verified commit exactly v<version>.',
    ]);
  });

  it('derives topological publish order from the package graph', async () => {
    const architecture = await loadArchitecture(fixtureRoot('valid'));
    const order = topologicalOrder(createDependencyGraph(architecture));
    const plan = releasePlan(fixtureRoot('valid'), { architecture });

    expect(order).toEqual(['core', 'app']);
    expect(order.map(id => lookupPackage(architecture, id)?.npmName)).toEqual(['@fixture/core', '@fixture/app']);
    expect(plan.publishOrder).toEqual(['@fixture/core', '@fixture/app']);
    expect(
      topologicalOrder(
        Object.freeze({
          zeta: Object.freeze([]),
          alpha: Object.freeze([]),
          middle: Object.freeze(['alpha']),
        }),
      ),
    ).toEqual(['alpha', 'middle', 'zeta']);
  });

  it('produces the same release plan twice', async () => {
    const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: ['release'] });
    if (snapshot.architecture === null) throw new Error('live governance snapshot has no architecture');
    const first = releasePlan(ROOT, { architecture: snapshot.architecture });
    const second = releasePlan(ROOT, { architecture: snapshot.architecture });
    const firstCommand = spawnSync(process.execPath, [join(ROOT, 'scripts', 'release', 'plan.mjs'), '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const secondCommand = spawnSync(process.execPath, [join(ROOT, 'scripts', 'release', 'plan.mjs'), '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.packages)).toBe(true);
    expect(Object.isFrozen(first.publishOrder)).toBe(true);
    expect(firstCommand).toMatchObject({ status: 0, stderr: '' });
    expect(secondCommand).toMatchObject({ status: 0, stderr: '' });
    expect(secondCommand.stdout).toBe(firstCommand.stdout);
  });

  it('bumps every catalog manifest and changelog as one train', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zmdb-release-bump-'));
    try {
      cpSync(fixtureRoot('valid'), root, { recursive: true });
      writeFileSync(join(root, 'yarn.lock'), 'original-lockfile\n');

      const result = runBump(root, '1.0.0-alpha.5');
      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(result.stdout).toContain('Prepared 1.0.0-alpha.5 across 2 catalog packages.');
      expect(readFileSync(join(root, 'fake-yarn.log'), 'utf8')).toBe('install --mode=update-lockfile\n');
      expect(readFileSync(join(root, 'yarn.lock'), 'utf8')).toBe('updated-by-fake-yarn\n');
      const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
      if (snapshot.architecture === null) throw new Error('bumped fixture has no architecture');
      expect(releasePlan(root, { architecture: snapshot.architecture })).toMatchObject({
        version: '1.0.0-alpha.5',
        packages: ['@fixture/app', '@fixture/core'],
        publishOrder: ['@fixture/core', '@fixture/app'],
      });
      for (const id of ['app', 'core']) {
        const manifest = readJson<{ version: string; publishConfig: { tag: string } }>(
          join(root, 'packages', id, 'package.json'),
        );
        expect(manifest).toMatchObject({
          version: '1.0.0-alpha.5',
          publishConfig: { tag: 'alpha' },
        });
      }
      const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
      expect(changelog).toContain('## [Unreleased]\n\n## [1.0.0-alpha.5] - 2026-09-06');
      expect(changelog).toContain('- **product:** reserve pending fixture changes.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores the complete train when lockfile regeneration fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zmdb-release-rollback-'));
    try {
      cpSync(fixtureRoot('valid'), root, { recursive: true });
      const watched = ['CHANGELOG.md', 'yarn.lock', 'packages/app/package.json', 'packages/core/package.json'];
      writeFileSync(join(root, 'yarn.lock'), 'original-lockfile\n');
      const before = new Map(watched.map(path => [path, readFileSync(join(root, path), 'utf8')]));

      const result = runBump(root, '1.0.0-alpha.5', 7);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('yarn install --mode=update-lockfile failed with status 7');
      for (const path of watched) expect(readFileSync(join(root, path), 'utf8'), path).toBe(before.get(path));
      const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
      if (snapshot.architecture === null) throw new Error('restored fixture has no architecture');
      expect(releasePlan(root, { architecture: snapshot.architecture }).version).toBe('1.0.0-alpha.4');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const GOVERNANCE_FIXTURES = join(FIXTURES, 'governance');
const GOVERNANCE_MODEL = join(ROOT, 'scripts', 'architecture', 'governance.mjs');
const EXCEPTION_MODEL = join(ROOT, 'scripts', 'architecture', 'exceptions.mjs');
const RELATIONSHIP_MODEL = join(ROOT, 'scripts', 'roadmap', 'native-relationships.mjs');

type IssueState = 'OPEN' | 'CLOSED';

interface RecordedSubIssue {
  readonly number: number;
  readonly parent: number | null;
  readonly openBlockers: readonly number[];
  readonly closedBlockers: readonly number[];
}

interface CountSplit {
  readonly total: number;
  readonly open: number;
  readonly closed: number;
}

interface RelationshipAuditFixture {
  readonly repository: 'ambasta/zmdb';
  readonly capturedAt: string;
  readonly baseline: {
    readonly openSubIssues: readonly RecordedSubIssue[];
    readonly blockedLabelIssues: readonly number[];
    readonly parenthesizedProjections: {
      readonly affectedBodies: readonly number[];
      readonly epicBodies: readonly number[];
      readonly openNonEpicBodies: readonly number[];
      readonly bodyCounts: CountSplit & { readonly openEpic: number; readonly openNonEpic: number };
      readonly occurrenceCounts: CountSplit;
      readonly checklistSuffixCounts: CountSplit;
      readonly openNonEpicOccurrenceCount: number;
    };
    readonly broaderBlockedByProse: {
      readonly bodies: number;
      readonly open: number;
      readonly closed: number;
      readonly openParenthesizedBodies: number;
      readonly openNonParenthesizedBodies: readonly number[];
      readonly requiredFinalOpenBodies: number;
      readonly closedHistoricalNarrativePolicy: string;
    };
    readonly expected: {
      readonly openSubIssues: number;
      readonly nativeParents: number;
      readonly nativeBlockedIssues: number;
      readonly openBlockerEdges: number;
      readonly actionable: readonly number[];
    };
  };
  readonly afterClosing732: {
    readonly closedIssues: readonly number[];
    readonly blockedLabelCount: number;
    readonly removed: {
      readonly epic: number;
      readonly issue: number;
      readonly blocker: number;
      readonly occurrences: number;
    };
    readonly parenthesizedProjections: {
      readonly bodyCounts: CountSplit & { readonly openEpic: number; readonly openNonEpic: number };
      readonly occurrenceCounts: CountSplit;
      readonly checklistSuffixCounts: CountSplit;
      readonly openNonEpicOccurrenceCount: number;
    };
    readonly expected: RelationshipTransitionExpected;
  };
  readonly afterClosing733: {
    readonly closedIssues: readonly number[];
    readonly blockedLabelCount: number;
    readonly removed: readonly {
      readonly epic: number;
      readonly issue: number;
      readonly blocker: number;
      readonly occurrences: number;
    }[];
    readonly parenthesizedProjections: {
      readonly bodyCounts: CountSplit & { readonly openEpic: number; readonly openNonEpic: number };
      readonly occurrenceCounts: CountSplit;
      readonly checklistSuffixCounts: CountSplit;
      readonly openNonEpicOccurrenceCount: number;
    };
    readonly expected: RelationshipTransitionExpected;
  };
  readonly repair: {
    readonly issue: number;
    readonly parent: number;
    readonly blockedBy: number;
    readonly preCloseExpected: RelationshipTransitionExpected;
    readonly liveExpected: RelationshipTransitionExpected;
  };
  readonly paginationCase: {
    readonly issues: readonly { readonly number: number; readonly state: IssueState }[];
    readonly issuePages: readonly (readonly number[])[];
    readonly subIssuePages: Readonly<Record<string, readonly (readonly number[])[]>>;
    readonly blockedByPages: Readonly<Record<string, readonly (readonly number[])[]>>;
    readonly expectedActionable: readonly number[];
  };
  readonly invalidCases: Readonly<
    Record<
      string,
      {
        readonly issues: readonly NativeIssue[];
        readonly expectedCode: string;
        readonly expectedCycle?: readonly number[];
      }
    >
  >;
}

interface RelationshipTransitionExpected {
  readonly openSubIssues: number;
  readonly nativeParents: number;
  readonly nativeBlockedIssues: number;
  readonly openBlockerEdges: number;
  readonly actionable: readonly number[];
}

interface ExceptionFixture {
  readonly finding: Readonly<Record<string, unknown>> & { readonly id: string; readonly code: string };
  readonly exception: Readonly<Record<string, unknown>>;
  readonly cases: readonly {
    readonly name: string;
    readonly ownerStates: Readonly<Record<string, IssueState>>;
    readonly rawFindingCount: number;
    readonly ceilingMaximum?: number;
    readonly removeWhen?: Readonly<Record<string, unknown>>;
    readonly copies?: number;
    readonly expectedCode: string;
  }[];
}

interface ConsumerFixture {
  readonly groups: readonly {
    readonly id: string;
    readonly paths: readonly string[];
    readonly externalRoot?: string;
    readonly expectedFindings?: number;
  }[];
  readonly commands: readonly string[];
  readonly generatedOutputs: readonly string[];
}

interface NativeIssue {
  readonly number: number;
  readonly state: IssueState;
  readonly parent: number | null;
  readonly subIssues: readonly number[];
  readonly blockedBy: readonly number[];
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly isSubIssue?: boolean;
}

interface NativeRelationshipSnapshot {
  readonly repository: 'ambasta/zmdb';
  readonly capturedAt: string;
  readonly complete: true;
  readonly issues: readonly NativeIssue[];
}

interface GovernanceSnapshotTarget {
  readonly findings: readonly { readonly id: string; readonly code: string }[];
  readonly packageGraph: ReadonlyMap<string, readonly string[]>;
  readonly queries: Readonly<Record<string, unknown>>;
}

interface GovernanceTarget {
  loadGovernanceSnapshot(input: {
    readonly root: string;
    readonly relationships?: NativeRelationshipSnapshot;
  }): Promise<GovernanceSnapshotTarget>;
  renderGovernanceReport(snapshot: GovernanceSnapshotTarget): string;
  verifyConsumerParity(input: { readonly root: string; readonly inventory: ConsumerFixture }): Promise<{
    readonly problems: readonly string[];
    readonly generatedOutputs: readonly string[];
    readonly queryDomains: readonly string[];
  }>;
}

interface ExceptionTarget {
  validateGovernanceExceptions(input: {
    readonly exceptions: readonly Readonly<Record<string, unknown>>[];
    readonly rawFindings: readonly Readonly<Record<string, unknown>>[];
    readonly ownerStates: Readonly<Record<string, IssueState>>;
  }): { readonly diagnostics: readonly { readonly code: string }[] };
}

interface Page<T> {
  readonly items: readonly T[];
  readonly nextPage: number | null;
}

interface RecordedRelationshipSource {
  listIssues(page: number): Promise<Page<{ readonly number: number; readonly state: IssueState }>>;
  getIssue?(issue: number): Promise<{ readonly number: number; readonly state: IssueState }>;
  listSubIssues(issue: number, page: number): Promise<Page<{ readonly number: number }>>;
  listBlockedBy(issue: number, page: number): Promise<Page<{ readonly number: number }>>;
}

interface NativeRelationshipTarget {
  readNativeRelationshipSnapshot(input: {
    readonly repository: 'ambasta/zmdb';
    readonly capturedAt: string;
    readonly source: RecordedRelationshipSource;
  }): Promise<NativeRelationshipSnapshot>;
  readGitHubNativeRelationshipSnapshot(input: {
    readonly repository: 'ambasta/zmdb';
  }): Promise<NativeRelationshipSnapshot>;
  computeActionability(snapshot: NativeRelationshipSnapshot): {
    readonly actionable: readonly number[];
    readonly blocked: readonly number[];
  };
  renderActionabilityReport(snapshot: NativeRelationshipSnapshot): string;
  applyNativeRelationshipBackfill(
    snapshot: NativeRelationshipSnapshot,
    repair: { readonly issue: number; readonly parent: number; readonly blockedBy: number },
  ): NativeRelationshipSnapshot;
  validateNativeRelationshipSnapshot(snapshot: NativeRelationshipSnapshot): {
    readonly diagnostics: readonly { readonly code: string }[];
    readonly cycle?: readonly number[];
  };
  renderNativeRelationshipDiagnostics(report: {
    readonly diagnostics: readonly { readonly code: string }[];
    readonly cycle?: readonly number[];
  }): string;
  planProjectionRemoval(input: {
    readonly snapshot: NativeRelationshipSnapshot;
    readonly audit: RelationshipAuditFixture;
  }): {
    readonly diagnostics: readonly { readonly code: string }[];
    readonly plan: {
      readonly labels: number;
      readonly affectedBodies: number;
      readonly parenthesizedOccurrences: number;
      readonly checklistSuffixes: number;
      readonly openBlockerProseBodies: number;
      readonly retainClosedHistoricalNarrative: boolean;
    } | null;
  };
}

interface MutableNativeIssue {
  number: number;
  state: IssueState;
  parent: number | null;
  subIssues: number[];
  blockedBy: number[];
}

async function importTarget<T>(path: string): Promise<T> {
  return (await import(`${pathToFileURL(path).href}?issue=733`)) as T;
}

function relationshipAudit(): RelationshipAuditFixture {
  return readJson<RelationshipAuditFixture>(join(GOVERNANCE_FIXTURES, 'relationships.json'));
}

function consumerFixture(): ConsumerFixture {
  return readJson<ConsumerFixture>(join(GOVERNANCE_FIXTURES, 'consumers.json'));
}

function baselineNativeSnapshot(
  audit: RelationshipAuditFixture,
  options: { readonly closedIssues?: readonly number[]; readonly repaired?: boolean } = {},
): NativeRelationshipSnapshot {
  const closed = new Set(options.closedIssues ?? []);
  const issues = new Map<number, MutableNativeIssue>();
  const ensure = (number: number, state: IssueState): MutableNativeIssue => {
    const existing = issues.get(number);
    if (existing !== undefined) return existing;
    const issue = { number, state, parent: null, subIssues: [], blockedBy: [] };
    issues.set(number, issue);
    return issue;
  };

  for (const recorded of audit.baseline.openSubIssues) ensure(recorded.number, 'OPEN');
  for (const recorded of audit.baseline.openSubIssues) {
    const issue = ensure(recorded.number, 'OPEN');
    const parent = options.repaired && recorded.number === audit.repair.issue ? audit.repair.parent : recorded.parent;
    issue.parent = parent;
    issue.blockedBy = [...recorded.openBlockers, ...recorded.closedBlockers].toSorted((left, right) => left - right);
    if (options.repaired && recorded.number === audit.repair.issue) issue.blockedBy.push(audit.repair.blockedBy);
    for (const blocker of recorded.openBlockers) ensure(blocker, 'OPEN');
    for (const blocker of recorded.closedBlockers) ensure(blocker, 'CLOSED');
    if (parent !== null) {
      const parentIssue = ensure(parent, 'OPEN');
      parentIssue.subIssues.push(recorded.number);
    }
  }
  for (const number of closed) ensure(number, 'CLOSED').state = 'CLOSED';

  return {
    repository: audit.repository,
    capturedAt: audit.capturedAt,
    complete: true,
    issues: [...issues.values()]
      .toSorted((left, right) => left.number - right.number)
      .map(issue => ({
        ...issue,
        subIssues: issue.subIssues.toSorted((left, right) => left - right),
        blockedBy: issue.blockedBy.toSorted((left, right) => left - right),
      })),
  };
}

function relationshipTransition(
  audit: RelationshipAuditFixture,
  options: { readonly closedIssues?: readonly number[]; readonly repaired?: boolean } = {},
): RelationshipTransitionExpected {
  const closed = new Set(options.closedIssues ?? []);
  const open = audit.baseline.openSubIssues.filter(issue => !closed.has(issue.number));
  const openBlockers = (issue: RecordedSubIssue): readonly number[] => {
    const blockers = issue.openBlockers.filter(number => !closed.has(number));
    return options.repaired && issue.number === audit.repair.issue ? [...blockers, audit.repair.blockedBy] : blockers;
  };
  return {
    openSubIssues: open.length,
    nativeParents: open.filter(
      issue => issue.parent !== null || (options.repaired && issue.number === audit.repair.issue),
    ).length,
    nativeBlockedIssues: open.filter(issue => openBlockers(issue).length > 0).length,
    openBlockerEdges: open.reduce((sum, issue) => sum + openBlockers(issue).length, 0),
    actionable: open.filter(issue => openBlockers(issue).length === 0).map(issue => issue.number),
  };
}

function recordedRelationshipSource(fixture: RelationshipAuditFixture['paginationCase']): {
  readonly source: RecordedRelationshipSource;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const issues = new Map(fixture.issues.map(issue => [issue.number, issue]));
  const page = <T>(pages: readonly (readonly T[])[], number: number): Page<T> => ({
    items: pages[number - 1] ?? [],
    nextPage: number < pages.length ? number + 1 : null,
  });
  const numbered = (values: readonly number[]): readonly { readonly number: number }[] =>
    values.map(number => ({ number }));

  return {
    calls,
    source: {
      async listIssues(number) {
        calls.push(`issues:${String(number)}`);
        const selected = page(fixture.issuePages, number);
        return {
          items: selected.items.map(issueNumber => {
            const issue = issues.get(issueNumber);
            if (issue === undefined) throw new Error(`pagination fixture omitted issue #${String(issueNumber)}`);
            return issue;
          }),
          nextPage: selected.nextPage,
        };
      },
      async listSubIssues(issue, number) {
        calls.push(`subIssues:${String(issue)}:${String(number)}`);
        const selected = page(fixture.subIssuePages[String(issue)] ?? [[]], number);
        return { items: numbered(selected.items), nextPage: selected.nextPage };
      },
      async listBlockedBy(issue, number) {
        calls.push(`blockedBy:${String(issue)}:${String(number)}`);
        const selected = page(fixture.blockedByPages[String(issue)] ?? [[]], number);
        return { items: numbered(selected.items), nextPage: selected.nextPage };
      },
    },
  };
}

async function withValidFixtureCopyAsync<T>(
  mutate: (root: string) => void,
  inspect: (root: string) => Promise<T>,
): Promise<T> {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-governance-freeze-'));
  const root = join(temporary, 'fixture');
  cpSync(fixtureRoot('valid'), root, { recursive: true });
  try {
    mutate(root);
    return await inspect(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function removeCatalogRow(source: string, id: string): string {
  const start = source.indexOf(`  Object.freeze({\n    id: '${id}',`);
  if (start < 0) throw new Error(`catalog fixture omitted ${id}`);
  const endMarker = '\n  }),';
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`catalog fixture row ${id} has no terminator`);
  return `${source.slice(0, start)}${source.slice(end + endMarker.length + 1)}`;
}

function findingCodes(snapshot: GovernanceSnapshotTarget): readonly string[] {
  return snapshot.findings.map(finding => finding.code);
}

function symmetricDifference(left: readonly number[], right: readonly number[]): readonly number[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return [...left.filter(number => !rightSet.has(number)), ...right.filter(number => !leftSet.has(number))].toSorted(
    (first, second) => first - second,
  );
}

// Measured at 696feb9739183341025a6dcc2bcf28eedda394b0: the three target modules did not exist.
// #736 retires only the native-relationship failures; #734 governance and #735 exception cases stay expected-failing.
describe('composed governance tests freeze (#733)', () => {
  it('records the exact #732 relationship baseline and #730 repair target', () => {
    const audit = relationshipAudit();
    expect(relationshipTransition(audit)).toEqual(audit.baseline.expected);
    expect(audit.baseline.blockedLabelIssues).toHaveLength(40);
    expect(audit.baseline.parenthesizedProjections.affectedBodies).toHaveLength(40);
    expect(audit.baseline.parenthesizedProjections.epicBodies).toHaveLength(30);
    expect(audit.baseline.parenthesizedProjections.openNonEpicBodies).toHaveLength(10);
    expect(audit.baseline.parenthesizedProjections.bodyCounts).toEqual({
      total: 40,
      open: 20,
      closed: 20,
      openEpic: 10,
      openNonEpic: 10,
    });
    expect(audit.baseline.parenthesizedProjections.occurrenceCounts).toEqual({
      total: 116,
      open: 50,
      closed: 66,
    });
    expect(audit.baseline.parenthesizedProjections.checklistSuffixCounts).toEqual({
      total: 106,
      open: 40,
      closed: 66,
    });
    expect(audit.afterClosing732).toMatchObject({
      closedIssues: [732],
      blockedLabelCount: 39,
      removed: { epic: 731, issue: 733, blocker: 732, occurrences: 1 },
      parenthesizedProjections: {
        bodyCounts: { total: 40 },
        occurrenceCounts: { total: 115, open: 49, closed: 66 },
        checklistSuffixCounts: { total: 105, open: 39, closed: 66 },
      },
    });
    expect(relationshipTransition(audit, { closedIssues: audit.afterClosing732.closedIssues })).toEqual(
      audit.afterClosing732.expected,
    );
    expect(audit.afterClosing733).toMatchObject({
      closedIssues: [732, 733],
      blockedLabelCount: 36,
      removed: [
        { epic: 731, issue: 734, blocker: 733, occurrences: 1 },
        { epic: 731, issue: 735, blocker: 733, occurrences: 1 },
        { epic: 731, issue: 736, blocker: 733, occurrences: 1 },
      ],
      parenthesizedProjections: {
        bodyCounts: { total: 40 },
        occurrenceCounts: { total: 112, open: 46, closed: 66 },
        checklistSuffixCounts: { total: 102, open: 36, closed: 66 },
      },
    });
    expect(relationshipTransition(audit, { closedIssues: audit.afterClosing733.closedIssues })).toEqual(
      audit.afterClosing733.expected,
    );
    expect(audit.baseline.broaderBlockedByProse).toMatchObject({
      bodies: 138,
      open: 21,
      closed: 117,
      openParenthesizedBodies: 20,
      openNonParenthesizedBodies: [730],
      requiredFinalOpenBodies: 0,
    });

    expect(relationshipTransition(audit, { repaired: true })).toEqual(audit.repair.preCloseExpected);
    expect(
      relationshipTransition(audit, {
        closedIssues: audit.afterClosing733.closedIssues,
        repaired: true,
      }),
    ).toEqual(audit.repair.liveExpected);
  });

  it('preserves every existing architecture violation fixture', () => {
    expect(FIXTURE_NAMES).toEqual([
      'valid',
      'cycle',
      'upward-edge',
      'undeclared-package',
      'tooling-leak',
      'peer-leak',
      'metadata-drift',
      'version-drift',
      'changelog-drift',
    ]);
    for (const name of FIXTURE_NAMES) expect(fixtureFiles(fixtureRoot(name))).toHaveLength(24);
    expect(Object.keys(EXPECTED_MUTATIONS).toSorted()).toEqual(
      FIXTURE_NAMES.filter(name => name !== 'valid').toSorted(),
    );
  });

  it('covers every frozen governance consumer and generated projection', () => {
    const fixture = consumerFixture();
    expect(fixture.groups.map(group => group.id)).toEqual([
      'architecture-model',
      'primary-architecture-verifiers',
      'specialized-gates',
      'catalog-facade-consumers',
      'release-model',
      'release-consumers',
      'generated-docs',
      'generated-projections',
      'temporary-baselines',
      'roadmap-plan',
      'roadmap-filing',
      'handover-operations',
      'legacy-filers',
      'operator-docs',
    ]);
    expect(fixture.commands).toHaveLength(10);
    expect(fixture.generatedOutputs).toEqual([
      'ARCHITECTURE.md',
      'docs-site/content/architecture.md',
      'docs-site/content/package-reference.md',
      'docs-site/content/framework-integrations.md',
    ]);
    for (const group of fixture.groups) {
      if (group.externalRoot !== undefined) continue;
      for (const path of group.paths) expect(existsSync(join(ROOT, path)), `${group.id}:${path}`).toBe(true);
    }
  });

  it('keeps recorded relationship tests free of network mutation instructions', () => {
    const source = readFileSync(join(GOVERNANCE_FIXTURES, 'relationships.json'), 'utf8');
    expect(source).not.toMatch(/"method"\s*:\s*"(?:POST|PUT|PATCH|DELETE)"/);
    expect(source).not.toContain('api.github.com');
  });

  it('loads the composed governance model and renders byte-stable architecture output', async () => {
    const permissionedImport = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${ROOT}`,
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(pathToFileURL(GOVERNANCE_MODEL).href)})`,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const target = await importTarget<GovernanceTarget>(GOVERNANCE_MODEL);
    const snapshot = await target.loadGovernanceSnapshot({ root: fixtureRoot('valid') });
    const expected = readFileSync(join(GOVERNANCE_FIXTURES, 'architecture-report.txt'), 'utf8');
    expect(permissionedImport).toMatchObject({ status: 0, stderr: '' });
    expect(snapshot.findings).toEqual([]);
    expect(Object.isFrozen(snapshot.packageGraph)).toBe(true);
    expect(Reflect.has(snapshot.packageGraph, 'set')).toBe(false);
    expect(Object.values(snapshot.queries).every(query => Object.isFrozen(query))).toBe(true);
    expect(target.renderGovernanceReport(snapshot)).toBe(expected);
    expect(target.renderGovernanceReport(snapshot)).toBe(expected);
  });

  it.each([
    ['missing catalog-policy membership', 'undeclared-package', 'ARCH_POLICY_MISSING'],
    ['workspace cycle', 'cycle', 'ARCH_CYCLE'],
    ['forbidden reachability', 'upward-edge', 'ARCH_EDGE_FORBIDDEN'],
    ['release-group drift', 'version-drift', 'PACKAGE_VERSION_DRIFT'],
  ] as const)('reports stable findings for %s', async (_name, fixture, expectedCode) => {
    const target = await importTarget<GovernanceTarget>(GOVERNANCE_MODEL);
    const snapshot = await target.loadGovernanceSnapshot({ root: fixtureRoot(fixture) });
    expect(findingCodes(snapshot)).toContain(expectedCode);
  });

  it('rejects a stale catalog row without discovering a second package inventory', async () => {
    const target = await importTarget<GovernanceTarget>(GOVERNANCE_MODEL);
    await withValidFixtureCopyAsync(
      root => {
        const path = join(root, 'scripts', 'product', 'catalog.mjs');
        writeFileSync(path, removeCatalogRow(readFileSync(path, 'utf8'), 'app'));
      },
      async root => {
        const snapshot = await target.loadGovernanceSnapshot({ root });
        expect(findingCodes(snapshot)).toContain('ARCH_POLICY_STALE');
      },
    );
  });

  it('rejects ring inflation from the canonical dependency graph', async () => {
    const target = await importTarget<GovernanceTarget>(GOVERNANCE_MODEL);
    await withValidFixtureCopyAsync(
      root => {
        const path = join(root, 'scripts', 'architecture', 'policy.mjs');
        const source = readFileSync(path, 'utf8');
        const current = "directory: 'packages/app',\n    zone: 'application',\n    ring: 1,";
        if (!source.includes(current)) throw new Error('valid fixture omitted the app ring');
        writeFileSync(path, source.replace(current, current.replace('ring: 1', 'ring: 2')));
      },
      async root => {
        const snapshot = await target.loadGovernanceSnapshot({ root });
        expect(findingCodes(snapshot)).toContain('ARCH_RING_INVALID');
      },
    );
  });

  it('preserves finding, command, release, helper and generated-byte parity for every consumer', async () => {
    const target = await importTarget<GovernanceTarget>(GOVERNANCE_MODEL);
    const inventory = consumerFixture();
    const report = await target.verifyConsumerParity({ root: ROOT, inventory });
    expect(report.problems).toEqual([]);
    expect(report.generatedOutputs).toEqual(inventory.generatedOutputs);
    expect(report.queryDomains).toEqual(['architecture', 'metadata', 'product', 'release', 'runtime']);
  }, 90_000);

  it('paginates native issues, children and blockers before computing actionability', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const recorded = recordedRelationshipSource(audit.paginationCase);
    const snapshot = await target.readNativeRelationshipSnapshot({
      repository: audit.repository,
      capturedAt: audit.capturedAt,
      source: recorded.source,
    });
    expect(target.computeActionability(snapshot).actionable).toEqual(audit.paginationCase.expectedActionable);
    expect(recorded.calls).toContain('issues:4');
    expect(recorded.calls).toContain('subIssues:900:3');
    expect(recorded.calls).toContain('blockedBy:103:2');
  });

  it('limits live-style reads to relation-bearing issues and retains closed endpoint rows', async () => {
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const calls: string[] = [];
    const source = {
      async listIssues(page: number) {
        calls.push(`issues:${String(page)}`);
        return {
          items:
            page === 1
              ? [
                  {
                    number: 900,
                    state: 'OPEN' as const,
                    title: 'Open epic',
                    isSubIssue: false,
                    relationshipReads: { subIssues: true, blockedBy: false },
                  },
                  {
                    number: 101,
                    state: 'OPEN' as const,
                    title: 'Open child',
                    parent: 900,
                    isSubIssue: true,
                    relationshipReads: { subIssues: false, blockedBy: true },
                  },
                  {
                    number: 777,
                    state: 'OPEN' as const,
                    title: 'Unrelated standalone issue',
                    isSubIssue: false,
                    relationshipReads: { subIssues: false, blockedBy: false },
                  },
                ]
              : [],
          nextPage: null,
        };
      },
      async listSubIssues(issue: number, page: number) {
        calls.push(`subIssues:${String(issue)}:${String(page)}`);
        if (issue !== 900 || page !== 1) throw new Error('unexpected sub-issue read');
        return {
          items: [
            {
              number: 100,
              state: 'CLOSED' as const,
              title: 'Just-closed child',
              labels: ['sub-issue'],
              relationshipReads: { subIssues: false, blockedBy: false },
            },
            {
              number: 101,
              state: 'OPEN' as const,
              title: 'Open child',
              parent: 900,
              isSubIssue: true,
              relationshipReads: { subIssues: false, blockedBy: true },
            },
          ],
          nextPage: null,
        };
      },
      async listBlockedBy(issue: number, page: number) {
        calls.push(`blockedBy:${String(issue)}:${String(page)}`);
        if (issue !== 101 || page !== 1) throw new Error('unexpected blocked-by read');
        return {
          items: [
            {
              number: 99,
              state: 'CLOSED' as const,
              title: 'Closed blocker',
              labels: ['sub-issue'],
              relationshipReads: { subIssues: false, blockedBy: false },
            },
          ],
          nextPage: null,
        };
      },
    };

    const snapshot = await target.readNativeRelationshipSnapshot({
      repository: 'ambasta/zmdb',
      capturedAt: '2026-09-06T10:30:00.000Z',
      source,
    });
    expect(calls).toEqual(['issues:1', 'subIssues:900:1', 'blockedBy:101:1']);
    expect(snapshot.issues.find(issue => issue.number === 100)).toMatchObject({
      state: 'CLOSED',
      title: 'Just-closed child',
      parent: 900,
      isSubIssue: true,
    });
    expect(snapshot.issues.find(issue => issue.number === 99)).toMatchObject({
      state: 'CLOSED',
      title: 'Closed blocker',
    });
    expect(target.computeActionability(snapshot).actionable).toEqual([101]);

    await expect(
      target.readNativeRelationshipSnapshot({
        repository: 'ambasta/zmdb',
        capturedAt: '2026-09-06T10:31:00.000Z',
        source: {
          async listIssues() {
            return {
              items: [
                {
                  number: 101,
                  state: 'OPEN' as const,
                  parent: 900,
                  isSubIssue: true,
                  relationshipReads: { subIssues: false, blockedBy: false },
                },
              ],
              nextPage: null,
            };
          },
          async getIssue() {
            return {
              number: 900,
              state: 'OPEN' as const,
            };
          },
          async listSubIssues() {
            throw new Error('missing open parent must fail before a relationship read');
          },
          async listBlockedBy() {
            throw new Error('missing open parent must fail before a relationship read');
          },
        },
      }),
    ).rejects.toThrow('paginated open issue collection omitted referenced parent #900');
  });

  it('computes actionability only from native blocked-by relationships', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const snapshot = baselineNativeSnapshot(audit);
    const projectionMutated: NativeRelationshipSnapshot = {
      ...snapshot,
      issues: snapshot.issues.map(issue => ({
        ...issue,
        labels: issue.number % 2 === 0 ? ['blocked'] : [],
        body:
          issue.number === 730 ? '**Blocked by:** #999' : `- [ ] #${String(issue.number)} — fixture (blocked by #999)`,
      })),
    };
    const before = target.computeActionability(snapshot);
    expect(Object.hasOwn(snapshot.issues[0] ?? {}, 'labels')).toBe(false);
    expect(Object.hasOwn(projectionMutated.issues[0] ?? {}, 'labels')).toBe(true);
    expect(before.actionable).toEqual(audit.baseline.expected.actionable);
    expect(target.computeActionability(projectionMutated)).toEqual(before);
    expect(target.renderActionabilityReport(projectionMutated)).toBe(target.renderActionabilityReport(snapshot));
  });

  it('changes actionability only for a closed issue and its native dependants', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const baseline = target.computeActionability(baselineNativeSnapshot(audit));
    const after732 = target.computeActionability(
      baselineNativeSnapshot(audit, { closedIssues: audit.afterClosing732.closedIssues }),
    );
    const after733 = target.computeActionability(
      baselineNativeSnapshot(audit, { closedIssues: audit.afterClosing733.closedIssues }),
    );

    expect(baseline.actionable).toEqual(audit.baseline.expected.actionable);
    expect(after732.actionable).toEqual(audit.afterClosing732.expected.actionable);
    expect(after733.actionable).toEqual(audit.afterClosing733.expected.actionable);
    expect(symmetricDifference(baseline.actionable, after732.actionable)).toEqual([732, 733]);
    expect(symmetricDifference(after732.actionable, after733.actionable)).toEqual([733, 734, 735, 736]);
  });

  it('reproduces the #732 baseline as byte-stable native actionability output', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const snapshot = baselineNativeSnapshot(audit);
    const expected = readFileSync(join(GOVERNANCE_FIXTURES, 'actionability-report.txt'), 'utf8');
    const report = target.computeActionability(snapshot);
    expect(report.actionable).toEqual(audit.baseline.expected.actionable);
    expect(report.blocked).toEqual(
      audit.baseline.openSubIssues.filter(issue => issue.openBlockers.length > 0).map(issue => issue.number),
    );
    expect(target.renderActionabilityReport(snapshot)).toBe(expected);
    expect(target.renderActionabilityReport(snapshot)).toBe(expected);
  });

  it('applies only the reviewed #730 parent and blocker backfill', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const before = baselineNativeSnapshot(audit, { closedIssues: audit.afterClosing733.closedIssues });
    const after = target.applyNativeRelationshipBackfill(before, audit.repair);
    expect(after).toEqual(
      baselineNativeSnapshot(audit, {
        closedIssues: audit.afterClosing733.closedIssues,
        repaired: true,
      }),
    );
    expect(target.computeActionability(after).actionable).toEqual(audit.repair.liveExpected.actionable);
  });

  it('rejects a native child whose parent and parent sub-issue collection disagree', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const fixture = audit.invalidCases['missingParent'];
    if (fixture === undefined) throw new Error('relationship fixture omitted missingParent');
    const report = target.validateNativeRelationshipSnapshot({
      repository: audit.repository,
      capturedAt: audit.capturedAt,
      complete: true,
      issues: fixture.issues,
    });
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual([fixture.expectedCode]);
  });

  it('reports one shortest dependency cycle deterministically', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const fixture = audit.invalidCases['cycle'];
    if (fixture === undefined) throw new Error('relationship fixture omitted cycle');
    const snapshot: NativeRelationshipSnapshot = {
      repository: audit.repository,
      capturedAt: audit.capturedAt,
      complete: true,
      issues: fixture.issues,
    };
    const first = target.validateNativeRelationshipSnapshot(snapshot);
    const second = target.validateNativeRelationshipSnapshot(snapshot);
    expect(first).toEqual(second);
    expect(first.diagnostics.map(diagnostic => diagnostic.code)).toEqual([fixture.expectedCode]);
    expect(first.cycle).toEqual(fixture.expectedCycle);
    expect(target.renderNativeRelationshipDiagnostics(first)).toBe(
      readFileSync(join(GOVERNANCE_FIXTURES, 'cycle-report.txt'), 'utf8'),
    );
  });

  it('refuses projection removal while #730 lacks its native parent and blocker', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const result = target.planProjectionRemoval({
      snapshot: baselineNativeSnapshot(audit, { closedIssues: audit.afterClosing733.closedIssues }),
      audit,
    });
    expect(result).toEqual({
      diagnostics: [{ code: 'GOV_PROJECTION_REMOVAL_NATIVE_BACKFILL_REQUIRED' }],
      plan: null,
    });
  });

  it('plans projection removal only from the repaired post-#732/#733 native snapshot', async () => {
    const audit = relationshipAudit();
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    const result = target.planProjectionRemoval({
      snapshot: baselineNativeSnapshot(audit, {
        closedIssues: audit.afterClosing733.closedIssues,
        repaired: true,
      }),
      audit,
    });
    expect(result).toEqual({
      diagnostics: [],
      plan: {
        labels: 36,
        affectedBodies: 40,
        parenthesizedOccurrences: 112,
        checklistSuffixes: 102,
        openBlockerProseBodies: 21,
        retainClosedHistoricalNarrative: true,
      },
    });
  });

  it('keeps repository roadmap consumers native-only and archives projection writers', async () => {
    const target = await importTarget<NativeRelationshipTarget>(RELATIONSHIP_MODEL);
    expect(target.readGitHubNativeRelationshipSnapshot).toBeTypeOf('function');

    const renderer = await importTarget<{
      renderChecklist(children: readonly Readonly<Record<string, unknown>>[]): string;
    }>(join(ROOT, 'scripts', 'roadmap', 'render.mjs'));
    expect(
      renderer.renderChecklist([
        { number: 734, shortTitle: 'governance model', blockedByNumbers: [733] },
        { number: 736, shortTitle: 'native cutover', blockedByNumbers: [733] },
      ]),
    ).toBe('- [ ] #734 — governance model\n- [ ] #736 — native cutover');

    const canonicalFiler = readFileSync(join(ROOT, 'scripts', 'roadmap', 'file-issues.mjs'), 'utf8');
    expect(canonicalFiler).toContain('issues/${numbers.get(key)}/dependencies/blocked_by');
    expect(canonicalFiler).toContain('issues/${parent.number}/sub_issues');
    expect(canonicalFiler).not.toContain("labels.push('blocked')");
    expect(canonicalFiler).not.toContain('blockedByNumbers:');
    const nativeReader = readFileSync(RELATIONSHIP_MODEL, 'utf8');
    expect(nativeReader).toContain("'issues?state=open'");
    expect(nativeReader).toContain('issue.sub_issues_summary?.total');
    expect(nativeReader).toContain('issue.issue_dependencies_summary?.total_blocked_by');
    expect(nativeReader).not.toContain('issue.issue_dependencies_summary?.blocked_by');
    expect(nativeReader).not.toContain("'issues?state=all'");

    for (const path of [
      '.github/scripts/file-web-epics.mjs',
      '.github/scripts/file-umbrella-epic.mjs',
      '.github/scripts/file-dx-epics.mjs',
    ]) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(source, path).toContain('scripts/roadmap/file-issues.mjs');
      expect(source, path).not.toContain("from 'node:child_process'");
      expect(source, path).not.toMatch(/['"]blocked['"]/);
      expect(source, path).not.toContain('(blocked by');
    }
  });

  it('prints CLI help without invoking GitHub', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'zmdb-native-help-'));
    try {
      const bin = join(temporary, 'bin');
      const marker = join(temporary, 'gh-called');
      mkdirSync(bin);
      const executable = join(bin, 'gh');
      writeFileSync(executable, `#!/bin/sh\nprintf called > "$GH_CALLED_MARKER"\nexit 97\n`);
      chmodSync(executable, 0o755);
      const result = spawnSync(process.execPath, [RELATIONSHIP_MODEL, '--help'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, GH_CALLED_MARKER: marker, PATH: bin },
      });
      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(result.stdout).toBe('usage: node scripts/roadmap/native-relationships.mjs [--repository owner/repo]\n');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it.fails.each(readJson<ExceptionFixture>(join(GOVERNANCE_FIXTURES, 'exceptions.json')).cases)(
    'rejects exception lifecycle drift: $name',
    async testCase => {
      const fixture = readJson<ExceptionFixture>(join(GOVERNANCE_FIXTURES, 'exceptions.json'));
      const target = await importTarget<ExceptionTarget>(EXCEPTION_MODEL);
      const exception = {
        ...fixture.exception,
        ...(testCase.ceilingMaximum === undefined
          ? {}
          : { ceiling: { metric: 'finding-count', maximum: testCase.ceilingMaximum } }),
        ...(testCase.removeWhen === undefined ? {} : { removeWhen: testCase.removeWhen }),
      };
      const exceptions = Array.from({ length: testCase.copies ?? 1 }, () => exception);
      const rawFindings = Array.from({ length: testCase.rawFindingCount }, (_, index) => ({
        ...fixture.finding,
        id: index === 0 ? fixture.finding.id : `${fixture.finding.id}/${String(index)}`,
      }));
      const report = target.validateGovernanceExceptions({
        exceptions,
        rawFindings,
        ownerStates: testCase.ownerStates,
      });
      expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual([testCase.expectedCode]);
    },
  );
});
