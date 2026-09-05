import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishManifest, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import { runPackedProject, type PackedProjectResult } from '../../../fixtures/client-adapters/src/packed-project.js';

const FIXTURE_SOURCES = [
  'conformance-cases.ts',
  'conformance.ts',
  'controllable-transport.ts',
  'generated/api.generated.ts',
  'package-matrix.ts',
  'packed-react.ts',
  'react-binding.ts',
  'ssr.ts',
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
  return Object.fromEntries(
    FIXTURE_SOURCES.map(path => [
      `src/${path}`,
      readFileSync(join(ROOT, 'fixtures', 'client-adapters', 'src', path), 'utf8'),
    ]),
  );
}

describe('@zmdb/react packed consumer', () => {
  let result: PackedProjectResult | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
  });

  it('installs published tarballs and runs the common conformance suite without workspace paths', () => {
    build('@zmdb/client');
    build('@zmdb/react');

    result = runPackedProject({
      name: '@zmdb-fixture/packed-react',
      packages: [
        {
          directory: join(ROOT, 'packages', 'client'),
          manifest: publishManifest(readManifest('client')),
        },
        {
          directory: join(ROOT, 'packages', 'react'),
          manifest: publishManifest(readManifest('react')),
        },
      ],
      dependencies: {
        react: '19.2.8',
        'react-dom': '19.2.8',
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
              skipLibCheck: false,
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
          label: 'packed React typecheck',
          command: process.execPath,
          arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
        },
        {
          label: 'packed React conformance',
          command: process.execPath,
          arguments: ['dist/packed-react.js'],
        },
      ],
    });

    expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/react']);
    expect(result.commands.map(command => [command.label, command.status])).toEqual([
      ['packed React typecheck', 0],
      ['packed React conformance', 0],
    ]);
    expect(JSON.parse(result.commands[1]?.stdout ?? '')).toEqual({
      package: '@zmdb/react',
      cases: 11,
      source: 'packed-tarballs',
    });
  }, 240_000);
});
