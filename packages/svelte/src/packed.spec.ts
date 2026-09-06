import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishManifest, publishTrain, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = join(import.meta.dirname, '../../..');
const RELEASE_VERSION = publishTrain(ROOT).version;
const FIXTURE = join(ROOT, 'fixtures', 'client-adapters', 'svelte-packed');
const FIXTURE_FILES = [
  'App.svelte',
  'Child.svelte',
  'bindings.mjs',
  'build.mjs',
  'contracts.ts',
  'tsconfig.json',
] as const;

function buildPackage(name: '@zmdb/client' | '@zmdb/svelte'): void {
  const result = spawnSync('yarn', ['workspace', name, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${name} build failed\n${result.stdout}\n${result.stderr}`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

describe('@zmdb/svelte packed consumers', () => {
  it(
    'packed Svelte browser and SSR fixtures pass common conformance',
    () => {
      const result = runPackedProject({
        name: '@zmdb-fixture/svelte-packed',
        buildLockRoot: ROOT,
        preparePackages() {
          buildPackage('@zmdb/client');
          buildPackage('@zmdb/svelte');
        },
        packages: [
          {
            directory: join(ROOT, 'packages', 'client'),
            manifest: publishManifest(readManifest('client'), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'svelte'),
            manifest: publishManifest(readManifest('svelte'), RELEASE_VERSION),
          },
        ],
        dependencies: {
          svelte: '5.57.0',
        },
        devDependencies: {
          esbuild: '0.28.2',
          typescript: '7.0.2',
        },
        files: Object.fromEntries(FIXTURE_FILES.map(path => [path, readFileSync(join(FIXTURE, path), 'utf8')])),
        commands: [
          {
            label: 'packed Svelte browser and SSR build',
            command: process.execPath,
            arguments: ['build.mjs'],
          },
          {
            label: 'packed Svelte public typecheck',
            command: process.execPath,
            arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
          },
        ],
      });

      try {
        expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/svelte']);
        expect(result.commands.map(command => command.status)).toEqual([0, 0]);
        const output: unknown = JSON.parse(result.commands[0]?.stdout.trim() ?? '');
        expect(output).toMatchObject({
          serverRenders: [true, true],
        });
        if (!isRecord(output)) throw new Error('packed Svelte build returned a non-object result');
        expect(output['browserBytes']).toBeGreaterThan(0);
      } finally {
        result.cleanup();
      }
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
