import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import {
  analyseToolingBoundaries,
  GENERATED_ARTIFACTS,
  findPackageCycle,
  parseOwnershipCatalog,
  ROOT,
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_EXPORTS,
  TARGET_TOOLING_MANIFESTS,
} from './verify-tooling-boundaries.mjs';

const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
if (GOVERNANCE.architecture === null) throw new Error('governance snapshot has no architecture');
const analyse = (options = {}) => analyseToolingBoundaries({ ...options, architecture: GOVERNANCE.architecture });

describe('the tooling-boundary verifier', () => {
  it('accounts for every frozen source path exactly once', () => {
    const result = analyse();
    expect(result.problems).toEqual([]);
    expect(result.inventory.actualCount).toBe(200);
    expect(result.inventory.ownerCounts).toEqual({
      compiler: 30,
      migrations: 23,
      cli: 31,
      runtime: 27,
      facade: 49,
      'optional-integration': 4,
      'test-only': 35,
      obsolete: 1,
    });
    expect(result.runtimeViolations.map(violation => violation.id).toSorted()).toEqual([
      '@zmdb/repository|compiler|packages/aot-validator/src/utilities/index.ts|../emit/shape.js',
      'zmdb|compiler|packages/aot-validator/src/utilities/index.ts|../emit/shape.js',
    ]);
    expect(result.generatedViolations).toHaveLength(3);
    expect(result.embeddedViolations).toEqual([]);
    expect(result.formatterViolations).toEqual([]);
    expect(result.packageGraph.edges).toHaveLength(71);
  });

  it('rejects a planted compiler import from a runtime root', () => {
    const entry = join(ROOT, 'packages', 'schema-core', 'src', 'index.ts');
    const overlays = new Map([[entry, `import 'typescript';\n${readFileSync(entry, 'utf8')}`]]);
    const result = analyse({ overlays });
    expect(result.problems).toContain(
      'new runtime tooling reachability @zmdb/schema-core|typescript|packages/schema-core/src/index.ts|typescript: packages/schema-core/src/index.ts -> typescript',
    );
  });

  it('rejects a planted compiler import in generated application code', () => {
    const path = GENERATED_ARTIFACTS.find(candidate => candidate.endsWith('orders.zmdb.generated.js'));
    expect(path).toBeDefined();
    const file = join(ROOT, path ?? '');
    const overlays = new Map([[file, `import '@zmdb/compiler';\n${readFileSync(file, 'utf8')}`]]);
    const result = analyse({ overlays });
    expect(result.problems).toContain(
      `new generated import violation ${String(path)} -> @zmdb/compiler (tooling-subpath)`,
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
    expect(TARGET_TOOLING_EXPORTS).toEqual({
      '@zmdb/compiler': [
        '.',
        './config',
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
        dependencies: ['@zmdb/aot-validator', '@zmdb/query-compiler', '@zmdb/schema-core'],
        peerDependencies: ['metro', 'metro-babel-transformer', 'oxlint', 'typescript'],
        optionalPeers: ['metro', 'metro-babel-transformer', 'oxlint'],
      },
      '@zmdb/migrations': {
        dependencies: ['@zmdb/query-compiler', 'oxfmt'],
        peerDependencies: [],
        optionalPeers: [],
      },
      '@zmdb/cli': {
        dependencies: ['@zmdb/compiler', '@zmdb/migrations', 'oxfmt'],
        peerDependencies: ['@zmdb/web', 'esbuild'],
        optionalPeers: ['@zmdb/web', 'esbuild'],
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
