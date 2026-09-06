import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishCatalog, publishManifest, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
  type PackedProjectResult,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const PUBLISH_PACKAGES = await publishCatalog(ROOT);

const HARNESS_SOURCES = [
  'conformance-cases.ts',
  'conformance.ts',
  'controllable-transport.ts',
  'generated/api.generated.ts',
  'package-matrix.ts',
  'packed-vue.ts',
  'ssr.ts',
  'vue-binding.ts',
] as const;

function build(packageName: string): void {
  const result = spawnSync('yarn', ['workspace', packageName, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${packageName} build failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`);
  }
}

function fixtureFiles(): Readonly<Record<string, string>> {
  const files = Object.fromEntries(
    HARNESS_SOURCES.map(path => [
      `src/${path}`,
      readFileSync(join(ROOT, 'fixtures', 'client-adapters', 'src', path), 'utf8'),
    ]),
  );
  for (const path of ['browser.ts', 'ssr.ts'] as const) {
    files[`src/consumer-${path}`] = readFileSync(join(ROOT, 'fixtures', 'client-adapters', 'vue', 'src', path), 'utf8');
  }
  files['src/lifecycles.ts'] = `import type { AdapterLifecycle } from './package-matrix.js';

export type RegisterCleanup = (cleanup: () => void) => void;

export interface ActivatedLifecycle<Value> {
  readonly value: Value;
  dispose(): Promise<void>;
}

export interface LifecycleHarness {
  readonly name: AdapterLifecycle;
  activate<Value>(
    setup: (registerCleanup: RegisterCleanup) => Value,
  ): Promise<ActivatedLifecycle<Value>>;
}
`;
  files['tsconfig.json'] = readFileSync(join(ROOT, 'fixtures', 'client-adapters', 'vue', 'tsconfig.json'), 'utf8');
  return files;
}

describe('@zmdb/vue packed consumers', () => {
  let result: PackedProjectResult | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
  });

  it(
    'installs published tarballs and runs browser, SSR, and common conformance without workspace paths',
    () => {
      result = runPackedProject({
        name: '@zmdb-fixture/packed-vue',
        buildLockRoot: ROOT,
        preparePackages() {
          build('@zmdb/client');
          build('@zmdb/vue');
        },
        packages: [
          {
            directory: join(ROOT, 'packages', 'client'),
            manifest: publishManifest(readManifest('client', PUBLISH_PACKAGES)),
          },
          {
            directory: join(ROOT, 'packages', 'vue'),
            manifest: publishManifest(readManifest('vue', PUBLISH_PACKAGES)),
          },
        ],
        dependencies: {
          vue: '3.5.42',
        },
        devDependencies: {
          '@types/node': '26.4.1',
          esbuild: '0.28.2',
          typescript: '7.0.2',
        },
        files: fixtureFiles(),
        commands: [
          {
            label: 'packed Vue typecheck',
            command: process.execPath,
            arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
          },
          {
            label: 'packed Vue browser bundle',
            command: process.execPath,
            arguments: [
              'node_modules/esbuild/bin/esbuild',
              'src/consumer-browser.ts',
              '--bundle',
              '--platform=browser',
              '--format=esm',
              '--outfile=dist/browser-bundle.js',
            ],
          },
          {
            label: 'packed Vue browser runtime',
            command: process.execPath,
            arguments: ['dist/browser-bundle.js'],
          },
          {
            label: 'packed Vue SSR runtime',
            command: process.execPath,
            arguments: ['dist/consumer-ssr.js'],
          },
          {
            label: 'packed Vue common conformance',
            command: process.execPath,
            arguments: ['dist/packed-vue.js'],
          },
        ],
      });

      expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/vue']);
      expect(result.commands.map(command => [command.label, command.status])).toEqual([
        ['packed Vue typecheck', 0],
        ['packed Vue browser bundle', 0],
        ['packed Vue browser runtime', 0],
        ['packed Vue SSR runtime', 0],
        ['packed Vue common conformance', 0],
      ]);
      expect(JSON.parse(result.commands[2]?.stdout ?? '')).toEqual({
        calls: ['browser'],
        result: { id: 'browser' },
      });
      expect(JSON.parse(result.commands[3]?.stdout ?? '')).toEqual({
        credentials: ['first', 'second'],
      });
      expect(JSON.parse(result.commands[4]?.stdout ?? '')).toEqual({
        package: '@zmdb/vue',
        cases: 11,
        source: 'packed-tarballs',
      });
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
