import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createImportGraph } from '../../../.github/scripts/lib/import-graph.mjs';
import {
  createDependencyGraph,
  loadArchitecture,
  lookupExport,
  lookupPackage,
  policyMembershipDiagnostics,
  topologicalOrder,
} from '../../../scripts/architecture/index.mjs';
import type { PackagePolicy } from '../../../scripts/architecture/policy.mjs';
import { PRODUCT_CATALOG } from '../../../scripts/product/catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'scripts', 'architecture', '__fixtures__');

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

    expect(architecture.packages.map(packageRecord => packageRecord.id)).toEqual(['core', 'app']);
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
      'architecture zones: 20 catalog packages, 37 workspace edges, and canonical rings verified.',
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
  // The two remaining `it.fails` cases belong to #728.
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
    expect(result.stdout).toContain('runtime reachability self-test: 9 case(s) passed.');
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

  it.fails('rejects a release version absent from CHANGELOG.md', () => {
    const result = runVerifier(VERIFIERS.release, fixtureRoot('changelog-drift'));
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[RELEASE_CHANGELOG_MISSING] 1.0.0-alpha.4 at CHANGELOG.md: no unique non-empty version section exists. Remediation: add one non-empty exact version section.',
    ]);
  });

  it.fails('rejects a tag that disagrees with package versions', () => {
    const result = runVerifier(VERIFIERS.release, fixtureRoot('valid'), '--tag', 'v1.0.0-alpha.5');
    expect(result.status).toBe(1);
    expect(diagnosticLines(result)).toEqual([
      '[RELEASE_TAG_MISMATCH] v1.0.0-alpha.5 against 1.0.0-alpha.4: triggering tag disagrees with the common package version. Remediation: tag the verified commit exactly v<version>.',
    ]);
  });

  it('derives topological publish order from the package graph', async () => {
    const architecture = await loadArchitecture(fixtureRoot('valid'));
    const order = topologicalOrder(createDependencyGraph(architecture));

    expect(order).toEqual(['core', 'app']);
    expect(order.map(id => lookupPackage(architecture, id)?.npmName)).toEqual(['@fixture/core', '@fixture/app']);
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
});
