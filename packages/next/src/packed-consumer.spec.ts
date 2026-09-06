import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishManifest, publishTrain, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
} from '../../../fixtures/client-adapters/src/packed-project.js';
import type { PackedProjectResult } from '../../../fixtures/client-adapters/src/packed-project.js';

const RELEASE_VERSION = publishTrain(ROOT).version;

const FIXTURE_FILES = [
  'app/api/scope/route.ts',
  'app/api/upstream/widgets/[id]/route.ts',
  'app/client-probe.tsx',
  'app/layout.tsx',
  'app/page.tsx',
  'lib/api.generated.ts',
  'lib/server.ts',
  'next-env.d.ts',
  'next.config.mjs',
  'tsconfig.json',
  'verify-boundary.mjs',
  'verify-runtime.mjs',
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
    FIXTURE_FILES.map(path => [path, readFileSync(join(ROOT, 'fixtures', 'next-app-router', path), 'utf8')]),
  );
}

describe('@zmdb/next packed App Router consumer', () => {
  let result: PackedProjectResult | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
  });

  it(
    'packed Next fixture builds and renders',
    () => {
      result = runPackedProject({
        name: '@zmdb-fixture/packed-next-app-router',
        buildLockRoot: ROOT,
        preparePackages() {
          build('@zmdb/client');
          build('@zmdb/react');
          build('@zmdb/next');
        },
        packages: [
          {
            directory: join(ROOT, 'packages', 'client'),
            manifest: publishManifest(readManifest('client'), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'react'),
            manifest: publishManifest(readManifest('react'), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'next'),
            manifest: publishManifest(readManifest('next'), RELEASE_VERSION),
          },
        ],
        dependencies: {
          next: '16.3.4',
          react: '19.2.8',
          'react-dom': '19.2.8',
        },
        devDependencies: {
          '@types/node': '26.4.1',
          '@types/react': '19.2.18',
          '@types/react-dom': '19.2.7',
          typescript: '7.0.2',
        },
        files: fixtureFiles(),
        commands: [
          {
            label: 'packed Next server-only boundary',
            command: process.execPath,
            arguments: ['verify-boundary.mjs'],
            env: { NEXT_TELEMETRY_DISABLED: '1' },
          },
          {
            label: 'packed Next build',
            command: process.execPath,
            arguments: ['node_modules/next/dist/bin/next', 'build'],
            env: { NEXT_TELEMETRY_DISABLED: '1' },
          },
          {
            label: 'packed Next runtime',
            command: process.execPath,
            arguments: ['verify-runtime.mjs'],
            env: { NEXT_TELEMETRY_DISABLED: '1' },
          },
        ],
      });

      expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/next', '@zmdb/react']);
      expect(result.commands.map(command => [command.label, command.status])).toEqual([
        ['packed Next server-only boundary', 0],
        ['packed Next build', 0],
        ['packed Next runtime', 0],
      ]);
      expect(JSON.parse(result.commands[0]?.stdout ?? '')).toEqual({
        plainNode: 'rejected',
        reactServer: 'imported',
        nextClientBuild: 'rejected',
      });
      expect(JSON.parse(result.commands[2]?.stdout ?? '')).toMatchObject({
        pages: 2,
        routeHandler: true,
        requestLocalMemoization: true,
      });
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
