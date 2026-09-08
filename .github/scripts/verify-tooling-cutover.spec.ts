import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import type { Architecture } from '../../scripts/architecture/index.mjs';
import { inspectRuntimeFoundation } from './verify-runtime-foundation.mjs';
import { analyseToolingBoundaries, ROOT } from './verify-tooling-boundaries.mjs';

const snapshot = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
const loadedArchitecture = snapshot.architecture;
if (loadedArchitecture === null) throw new Error('The tooling cutover requires the real governance package inventory');
const architecture: Architecture = loadedArchitecture;

const retired = {
  '@zmdb/validator': [
    './codegen',
    './emit',
    './lint',
    './metro',
    './plugin',
    './reflect',
    './testing',
    './transformer',
    './unplugin',
  ],
  '@zmdb/sql': ['./introspect', './migrations', './migrations/embedded', './migrations/runner'],
  '@zmdb/compiler': ['./codegen', './plugin', './transformer'],
  zmdb: ['./unplugin'],
};

function analyse(overlays = new Map<string, string>(), input: Architecture = architecture) {
  return analyseToolingBoundaries({ root: ROOT, architecture: input, classifyExceptions: false, overlays });
}

function withManifestEdge(packageName: string, field: string, dependency: string, optionalPeer = false) {
  const rewrite = <T extends { readonly manifest: Readonly<Record<string, unknown>> }>(record: T): T => {
    if (record.manifest.name !== packageName) return record;
    const previous = record.manifest[field];
    return {
      ...record,
      manifest: {
        ...record.manifest,
        [field]: {
          ...(typeof previous === 'object' && previous !== null ? previous : {}),
          [dependency]: 'workspace:^',
        },
        ...(optionalPeer ? { peerDependenciesMeta: { [dependency]: { optional: true } } } : {}),
      },
    };
  };
  return {
    ...architecture,
    packages: architecture.packages.map(rewrite),
    workspacePackages: architecture.workspacePackages.map(rewrite),
  };
}

describe('final tooling ownership cutover (#631)', () => {
  it('finds no old compiler, migration or CLI implementation outside the three owner packages', () => {
    const result = analyse();
    expect(result.problems).toEqual([]);
    expect(result.runtimeViolations).toEqual([]);
    expect(result.generatedViolations).toEqual([]);
    expect(result.embeddedViolations).toEqual([]);
    expect(result.formatterViolations).toEqual([]);
    for (const owner of ['compiler', 'migrations', 'cli']) {
      const entries = result.inventory.catalog.filter(entry => entry.owner === owner);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.filter(entry => !entry.path.startsWith(`packages/${owner}/src/`))).toEqual([]);
    }
    for (const path of [
      'packages/validator/src/codegen',
      'packages/validator/src/emit',
      'packages/validator/src/reflect',
      'packages/validator/src/config',
      'packages/sql/src/migrations/index.ts',
      'packages/sql/src/migrations/runner.ts',
      'packages/sql/src/migrations/embedded.ts',
      'packages/sql/src/introspect/index.ts',
      'packages/zmdb/src/studio',
      'packages/zmdb/src/unplugin.ts',
    ])
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    expect(readdirSync(join(ROOT, 'packages/zmdb/src/cli'))).toEqual(['index.ts']);
  });

  it('finds no published old tooling subpath or zmdb-codegen bin', () => {
    for (const [name, subpaths] of Object.entries(retired)) {
      const manifest = architecture.workspacePackages.find(record => record.manifest.name === name)?.manifest;
      expect(manifest, name).toBeDefined();
      for (const subpath of subpaths)
        expect(manifest?.exports, `${name}${subpath.slice(1)}`).not.toHaveProperty(subpath);
    }
    expect(analyse().binOwners).toEqual(['@zmdb/cli|zmdb']);
    const product = architecture.workspacePackages.find(record => record.manifest.name === 'zmdb')?.manifest;
    expect(product?.bin).toBeUndefined();
    for (const selector of ['./compiler', './migrations', './testing', './config', './cli']) {
      expect(product?.exports).toHaveProperty(selector);
    }
  });

  it('keeps Metro owned by its explicit adapter entry', async () => {
    const adapter = await import('@zmdb/compiler/metro');
    const facade = await import('zmdb/compiler');
    for (const name of ['getCacheKey', 'transform', 'withZmdb'] as const) {
      expect(typeof adapter[name]).toBe('function');
      expect(facade).not.toHaveProperty(name);
    }
    expect(facade).not.toHaveProperty('MetroOptions');
    const manifest = architecture.workspacePackages.find(record => record.manifest.name === '@zmdb/compiler')?.manifest;
    expect(manifest?.exports).toHaveProperty('./metro', './src/metro/metro.ts');
  });

  it('rejects a synthetic runtime-to-tooling import and accepts every declared tooling edge', () => {
    expect(analyse().packageGraph.problems).toEqual([]);
    expect(analyse().runtimeViolations).toEqual([]);
    const entry = join(ROOT, 'packages/schema/src/index.ts');
    const original = readFileSync(entry, 'utf8');
    for (const specifier of [
      '@zmdb/compiler',
      '@zmdb/compiler/config',
      '@zmdb/migrations/files',
      '@zmdb/cli',
      'typescript',
      'oxlint',
      'oxfmt',
      'esbuild',
      'node:repl',
      'node:fs',
      'node:fs/promises',
    ]) {
      const result = analyse(new Map([[entry, `import ${JSON.stringify(specifier)};\n${original}`]]));
      expect(
        result.runtimeViolations.some(finding => finding.specifier === specifier),
        specifier,
      ).toBe(true);
    }
    for (const [name, field, dependency, optional] of [
      ['@zmdb/schema', 'dependencies', '@zmdb/compiler', false],
      ['@zmdb/validator', 'optionalDependencies', '@zmdb/cli', false],
      ['@zmdb/validator', 'peerDependencies', '@zmdb/compiler', true],
      ['@zmdb/sql', 'dependencies', 'typescript', false],
      ['@zmdb/orm', 'dependencies', 'oxfmt', false],
      ['@zmdb/compiler', 'dependencies', '@zmdb/migrations', false],
      ['@zmdb/migrations', 'peerDependencies', '@zmdb/compiler', false],
    ] as const) {
      const result = analyse(new Map(), withManifestEdge(name, field, dependency, optional));
      expect(
        result.problems.some(problem => problem.includes(name) && problem.includes(dependency)),
        `${name} ${field} ${dependency}`,
      ).toBe(true);
    }
    const generated = join(ROOT, 'fixtures/consumer-cli/src/orders.zmdb.generated.js');
    const leaked = analyse(new Map([[generated, `import '@zmdb/compiler';\n${readFileSync(generated, 'utf8')}`]]));
    expect(leaked.generatedViolations.some(finding => finding.specifier === '@zmdb/compiler')).toBe(true);
    const embedded = join(ROOT, 'packages/migrations/src/embedded.ts');
    expect(
      analyse(new Map([[embedded, `import 'node:fs';\n${readFileSync(embedded, 'utf8')}`]])).embeddedViolations,
    ).not.toEqual([]);
  }, 20_000);

  it('finds exactly one TypeIR producer, one migration diff implementation and one command dispatcher', () => {
    expect(analyse().problems).toEqual([]);
    const foreignOwner = join(ROOT, 'packages/validator/src/index.ts');
    const original = readFileSync(foreignOwner, 'utf8');
    for (const declaration of [
      'export function irFromType() { return undefined; }',
      'export class ReflectSession {}',
      'export function loadConfig() { return undefined; }',
      'export function resolveConfig() { return undefined; }',
      'export function diff() { return []; }',
      'export async function runCli() { return 0; }',
    ]) {
      const result = analyse(new Map([[foreignOwner, `${original}\n${declaration}\n`]]));
      expect(
        result.problems.some(
          problem =>
            problem.includes('TOOLING_IMPLEMENTATION_OWNER') && problem.includes('packages/validator/src/index.ts'),
        ),
        declaration,
      ).toBe(true);
    }
    const comment = analyse(new Map([[foreignOwner, `${original}\n// export function runCli() { return 0; }\n`]]));
    expect(comment.problems).toEqual([]);
  });

  it('distinguishes type-only removed-entry refusals from positive imports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zmdb-tooling-type-refusal-'));
    try {
      mkdirSync(join(directory, 'fixtures'));
      mkdirSync(join(directory, 'packages'));
      const entry = join(directory, 'fixtures/refusal.ts');
      const negative =
        '// @ts-expect-error the removed entry has no declarations\n' +
        "import type { compileProject } from '@zmdb/aot-validator/codegen';\n";
      const inspect = () =>
        inspectRuntimeFoundation(directory, {
          architecture: { ...architecture, packages: [], workspacePackages: [] },
          checkOwnership: false,
          checkConsumers: false,
          requireAll: false,
        }).problems;
      writeFileSync(entry, negative);
      expect(inspect()).toEqual([]);
      for (const source of [
        negative.replace('// @ts-expect-error the removed entry has no declarations\n', ''),
        negative.replace('import type', 'import'),
        negative + "import { compileProject as positive } from '@zmdb/aot-validator/codegen';\n",
      ]) {
        writeFileSync(entry, source);
        expect(inspect()).toContainEqual(expect.stringContaining('@zmdb/aot-validator/codegen'));
      }
      rmSync(entry);
      writeFileSync(join(directory, 'packages/production.ts'), negative);
      expect(inspect()).toContainEqual(expect.stringContaining('@zmdb/aot-validator/codegen'));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('imports runtime roots without TypeScript, formatter, CLI, filesystem tooling or optional command modules', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zmdb-tooling-cutover-proof-'));
    try {
      execFileSync(
        process.execPath,
        [
          join(ROOT, 'fixtures/consumer-tooling-cutover/verify-installed.mjs'),
          '--root',
          ROOT,
          '--evidence-dir',
          directory,
        ],
        { cwd: ROOT, env: { ...process.env, ZMDB_CLI_EVIDENCE: directory }, timeout: 600_000, maxBuffer: 16_777_216 },
      );
      const report = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      expect(report.ok).toBe(true);
      expect(report.roles).toEqual(['compiler', 'migrations', 'cli', 'product']);
      expect(report.cleanup).toEqual({ children: [], ports: [], processes: [] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 610_000);
});
