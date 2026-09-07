import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import {
  analyseToolingBoundaries,
  GENERATED_ARTIFACTS,
  findPackageCycle,
  parseOwnershipCatalog,
  RETIRED_AOT_TOOLING_EXPORTS,
  ROOT,
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_EXPORTS,
  TARGET_TOOLING_MANIFESTS,
} from './verify-tooling-boundaries.mjs';

const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
const ARCHITECTURE = GOVERNANCE.architecture;
if (ARCHITECTURE === null) throw new Error('governance snapshot has no architecture');
const analyse = (options = {}) =>
  analyseToolingBoundaries({ ...options, architecture: ARCHITECTURE, snapshot: GOVERNANCE });

describe('the tooling-boundary verifier', () => {
  it('accounts for every frozen source path exactly once', () => {
    const result = analyse();
    expect(result.problems).toEqual([]);
    expect(result.inventory.actualCount).toBe(209);
    expect(result.inventory.ownerCounts).toEqual({
      compiler: 34,
      migrations: 21,
      cli: 33,
      runtime: 30,
      facade: 53,
      'optional-integration': 0,
      'test-only': 38,
      obsolete: 0,
    });
    expect(result.runtimeViolations).toEqual([]);
    expect(result.generatedViolations).toEqual([]);
    expect(result.embeddedViolations).toEqual([]);
    expect(result.formatterViolations).toEqual([]);
    const ownedEdges = [
      ['@zmdb/cli', '@zmdb/compiler'],
      ['@zmdb/cli', '@zmdb/migrations'],
      ['zmdb', '@zmdb/cli'],
    ];
    const owned = ([from, to]: readonly string[]) => from === '@zmdb/cli' || to === '@zmdb/cli';
    expect(result.packageGraph.edges.filter(owned)).toEqual(ownedEdges);
    const manifests: { name: string; dependencies?: Record<string, string> }[] = readdirSync(join(ROOT, 'packages'))
      .map(name => join(ROOT, 'packages', name, 'package.json'))
      .filter(path => existsSync(path))
      .map(path => JSON.parse(readFileSync(path, 'utf8')));
    const names = new Set(manifests.map(manifest => manifest.name));
    const otherEdges = manifests.flatMap(manifest =>
      Object.keys(manifest.dependencies ?? {})
        .filter(name => names.has(name))
        .map(name => [manifest.name, name])
        .filter(edge => !owned(edge)),
    );
    expect(
      result.packageGraph.edges
        .filter(edge => !owned(edge))
        .map(edge => edge.join('\0'))
        .toSorted(),
    ).toEqual(otherEdges.map(edge => edge.join('\0')).toSorted());
  });

  it('rejects a planted compiler import from a runtime root', () => {
    const entry = join(ROOT, 'packages', 'schema-core', 'src', 'index.ts');
    const overlays = new Map([[entry, `import 'typescript';\n${readFileSync(entry, 'utf8')}`]]);
    const result = analyse({ overlays });
    expect(result.problems).toContainEqual(
      expect.stringContaining(
        '[GOV_EXCEPTION_UNOWNED_FINDING] TOOLING_RUNTIME_REACHABILITY/entry/' +
          'schema-core%3Apackages%2Fschema-core%2Fsrc%2Findex.ts%3Atypescript',
      ),
    );
  });

  it('rejects a planted compiler import in generated application code', () => {
    const path = GENERATED_ARTIFACTS.find(candidate => candidate.endsWith('orders.zmdb.generated.js'));
    expect(path).toBeDefined();
    const file = join(ROOT, path ?? '');
    const overlays = new Map([[file, `import '@zmdb/compiler';\n${readFileSync(file, 'utf8')}`]]);
    const result = analyse({ overlays });
    expect(result.problems).toContainEqual(
      expect.stringContaining(
        `[GOV_EXCEPTION_UNOWNED_FINDING] TOOLING_GENERATED_IMPORT/path/${encodeURIComponent(String(path))}`,
      ),
    );
  });

  it('rejects forbidden imports from migration entries', () => {
    const embedded = join(ROOT, 'packages', 'migrations', 'src', 'embedded.ts');
    const embeddedOverlay = new Map([[embedded, `import 'node:fs';\n${readFileSync(embedded, 'utf8')}`]]);
    expect(analyse({ overlays: embeddedOverlay }).problems).toContain(
      'embedded migrations reaches forbidden import packages/migrations/src/embedded.ts -> node:fs',
    );

    const root = join(ROOT, 'packages', 'migrations', 'src', 'index.ts');
    const formatterOverlay = new Map([[root, `import 'oxfmt';\n${readFileSync(root, 'utf8')}`]]);
    expect(analyse({ overlays: formatterOverlay }).problems).toContain(
      'migration entry . reaches formatter packages/migrations/src/index.ts -> oxfmt: ' +
        'packages/migrations/src/index.ts -> oxfmt',
    );
  });

  it('freezes exact future package exports and refuses duplicate ownership rows', () => {
    expect(RETIRED_AOT_TOOLING_EXPORTS).toEqual([
      './codegen',
      './emit',
      './lint',
      './metro',
      './plugin',
      './reflect',
      './testing',
      './transformer',
      './unplugin',
    ]);
    expect(TARGET_TOOLING_EXPORTS).toEqual({
      '@zmdb/compiler': [
        '.',
        './config',
        './config/contract',
        './emit',
        './errors',
        './lint',
        './metro',
        './reflect',
        './testing',
        './transform',
        './unplugin',
      ],
      '@zmdb/migrations': [
        '.',
        './declarations',
        './embedded',
        './files',
        './introspect',
        './introspect/runtime',
        './runner',
        './testing',
      ],
      '@zmdb/cli': ['.'],
    });
    expect(() =>
      parseOwnershipCatalog(`## 2. Exact source move map

\`\`\`text
compiler	packages/example/src/index.ts
runtime	packages/example/src/index.ts
\`\`\`
`),
    ).toThrow('lists packages/example/src/index.ts more than once');
  });

  it('freezes the future manifest DAG and detects a synthetic package cycle', () => {
    expect(TARGET_PRODUCT_TOOLING_EXPORTS).toEqual({
      '@zmdb/compiler': ['./compiler', './config'],
      '@zmdb/migrations': ['./migrations'],
      '@zmdb/cli': ['./cli'],
    });
    expect(TARGET_TOOLING_MANIFESTS).toEqual({
      '@zmdb/compiler': {
        dependencies: ['@zmdb/ai'],
        peerDependencies: [
          '@zmdb/aot-validator',
          '@zmdb/query-compiler',
          '@zmdb/schema-core',
          'metro',
          'metro-babel-transformer',
          'oxlint',
          'typescript',
        ],
        optionalPeers: ['metro', 'metro-babel-transformer', 'oxlint'],
      },
      '@zmdb/migrations': {
        dependencies: ['oxfmt'],
        peerDependencies: ['@zmdb/query-compiler'],
        optionalPeers: [],
      },
      '@zmdb/cli': {
        dependencies: ['@zmdb/compiler', '@zmdb/migrations', 'oxfmt'],
        peerDependencies: [
          '@zmdb/app',
          '@zmdb/query-compiler',
          '@zmdb/repository',
          '@zmdb/schema-core',
          '@zmdb/web',
          'esbuild',
          'typescript',
        ],
        optionalPeers: ['@zmdb/app', '@zmdb/web', 'esbuild'],
      },
    });
    expect(
      findPackageCycle([
        ['@zmdb/compiler', '@zmdb/aot-validator'],
        ['@zmdb/aot-validator', '@zmdb/compiler'],
      ]),
    ).toEqual(['@zmdb/compiler', '@zmdb/aot-validator', '@zmdb/compiler']);
  });
});
