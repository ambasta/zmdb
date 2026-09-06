import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishManifest, publishTrain, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import { runPackedProject, type PackedProjectResult } from '../../../fixtures/client-adapters/src/packed-project.js';

const RELEASE = await publishTrain(ROOT);
const RELEASE_VERSION = RELEASE.version;

const FIXTURE_SOURCES = [
  'conformance-cases.ts',
  'conformance.ts',
  'controllable-transport.ts',
  'generated/api.generated.ts',
  'package-matrix.ts',
  'packed-react-native.ts',
  'react-binding.ts',
  'react-native-binding.ts',
  'ssr.ts',
] as const;

function copyPackageSource(name: string, buildRoot: string): void {
  const source = join(ROOT, 'packages', name);
  cpSync(source, join(buildRoot, 'packages', name), {
    recursive: true,
    dereference: true,
    filter(path) {
      const rel = relative(source, path);
      const first = rel.split(sep)[0];
      return first !== 'dist' && first !== 'node_modules';
    },
  });
}

function createIsolatedBuildRoot(): string {
  const buildRoot = mkdtempSync(join(tmpdir(), 'zmdb-react-native-build-'));
  mkdirSync(join(buildRoot, 'packages'), { recursive: true });
  mkdirSync(join(buildRoot, 'scripts'), { recursive: true });
  copyFileSync(join(ROOT, 'tsconfig.json'), join(buildRoot, 'tsconfig.json'));
  copyFileSync(join(ROOT, 'tsconfig.build.json'), join(buildRoot, 'tsconfig.build.json'));
  copyFileSync(join(ROOT, 'scripts', 'build-package.mjs'), join(buildRoot, 'scripts', 'build-package.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(buildRoot, 'node_modules'), 'dir');
  for (const name of ['client', 'react', 'react-native']) copyPackageSource(name, buildRoot);
  return buildRoot;
}

function build(buildRoot: string, packageName: string): void {
  const directory = packageName.slice('@zmdb/'.length);
  const result = spawnSync(process.execPath, [join(buildRoot, 'scripts', 'build-package.mjs')], {
    cwd: join(buildRoot, 'packages', directory),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${packageName} build failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`);
  }
}

function fixtureFiles(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    FIXTURE_SOURCES.map(path => [
      `src/${path}`,
      readFileSync(join(ROOT, 'fixtures', 'client-adapters', 'src', path), 'utf8'),
    ]),
  );
}

describe('@zmdb/react-native packed consumer', () => {
  let result: PackedProjectResult | undefined;
  let buildRoot: string | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
    if (buildRoot !== undefined) rmSync(buildRoot, { recursive: true, force: true });
    buildRoot = undefined;
  });

  it('packed native consumer passes lifecycle conformance', () => {
    buildRoot = createIsolatedBuildRoot();
    build(buildRoot, '@zmdb/client');
    build(buildRoot, '@zmdb/react');
    build(buildRoot, '@zmdb/react-native');

    result = runPackedProject({
      name: '@zmdb-fixture/packed-react-native',
      packages: [
        {
          directory: join(buildRoot, 'packages', 'client'),
          manifest: publishManifest(readManifest('client', RELEASE), RELEASE_VERSION),
        },
        {
          directory: join(buildRoot, 'packages', 'react'),
          manifest: publishManifest(readManifest('react', RELEASE), RELEASE_VERSION),
        },
        {
          directory: join(buildRoot, 'packages', 'react-native'),
          manifest: publishManifest(readManifest('react-native', RELEASE), RELEASE_VERSION),
        },
      ],
      dependencies: {
        react: '19.2.8',
        'react-dom': '19.2.8',
        'react-native': '0.87.1',
        'react-test-renderer': '19.2.8',
      },
      devDependencies: {
        '@types/node': '26.4.1',
        '@types/react': '19.2.18',
        '@types/react-dom': '19.2.7',
        '@types/react-test-renderer': '19.1.0',
        typescript: '7.0.2',
      },
      files: {
        ...fixtureFiles(),
        'src/lifecycles.ts': `import type { AdapterLifecycle } from './package-matrix.js';

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
`,
        'tsconfig.json': `${JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              lib: ['ESNext', 'DOM', 'DOM.Iterable'],
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmitOnError: true,
              noUncheckedIndexedAccess: true,
              outDir: 'dist',
              rootDir: 'src',
              skipLibCheck: true,
              strict: true,
              target: 'ESNext',
              types: ['node'],
              verbatimModuleSyntax: true,
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      },
      commands: [
        {
          label: 'packed React Native typecheck',
          command: process.execPath,
          arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
        },
        {
          label: 'packed React Native lifecycle',
          command: process.execPath,
          arguments: ['dist/packed-react-native.js'],
        },
      ],
    });

    expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/react', '@zmdb/react-native']);
    expect(result.commands.map(command => [command.label, command.status])).toEqual([
      ['packed React Native typecheck', 0],
      ['packed React Native lifecycle', 0],
    ]);
    expect(JSON.parse(result.commands[1]?.stdout ?? '')).toEqual({
      package: '@zmdb/react-native',
      commonCases: 11,
      nativeCases: 2,
      source: 'packed-tarballs',
    });
  }, 360_000);
});
