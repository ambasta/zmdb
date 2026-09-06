import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishManifest, publishTrain, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
  withPackedBuildLock,
  type PackedProjectResult,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const FIXTURE_ROOT = join(ROOT, 'fixtures', 'client-adapters', 'nuxt');
const RELEASE = await publishTrain(ROOT);
const RELEASE_VERSION = RELEASE.version;

function build(packageName: string): void {
  const result = spawnSync('yarn', ['workspace', packageName, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${packageName} build failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`);
  }
}

function fixture(path: string): string {
  return readFileSync(join(FIXTURE_ROOT, path), 'utf8');
}

function fixtureFiles(): Readonly<Record<string, string>> {
  return {
    'nuxt.config.ts': fixture('nuxt.config.ts'),
    'app/app.vue': fixture('app/app.vue'),
    'app/zmdb.ts': fixture('app/zmdb.ts'),
    'app/generated/api.generated.ts': readFileSync(
      join(ROOT, 'fixtures', 'client-adapters', 'src', 'generated', 'api.generated.ts'),
      'utf8',
    ),
    'server/api/observations.get.ts': fixture('server/api/observations.get.ts'),
    'server/api/widgets/[id].get.ts': fixture('server/api/widgets/[id].get.ts'),
    'server/utils/observations.ts': fixture('server/utils/observations.ts'),
    'browser.ts': fixture('browser.ts'),
    'browser-tsconfig.json': fixture('browser-tsconfig.json'),
    'verify-built.mjs': fixture('verify-built.mjs'),
  };
}

describe('@zmdb/nuxt packed consumers', () => {
  let result: PackedProjectResult | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
  });

  it(
    'packed Nuxt fixture builds and renders',
    () => {
      result = withPackedBuildLock(ROOT, () => {
        build('@zmdb/client');
        build('@zmdb/vue');
        build('@zmdb/nuxt');

        return runPackedProject({
          name: '@zmdb-fixture/packed-nuxt',
          packages: [
            {
              directory: join(ROOT, 'packages', 'client'),
              manifest: publishManifest(readManifest('client', RELEASE), RELEASE_VERSION),
            },
            {
              directory: join(ROOT, 'packages', 'vue'),
              manifest: publishManifest(readManifest('vue', RELEASE), RELEASE_VERSION),
            },
            {
              directory: join(ROOT, 'packages', 'nuxt'),
              manifest: publishManifest(readManifest('nuxt', RELEASE), RELEASE_VERSION),
            },
          ],
          dependencies: {
            nuxt: '4.5.2',
            rolldown: '1.2.7',
            vue: '3.5.42',
          },
          devDependencies: {
            '@types/node': '26.4.1',
            typescript: '7.0.2',
          },
          files: fixtureFiles(),
          commands: [
            {
              label: 'packed Nuxt build',
              command: process.execPath,
              arguments: ['node_modules/nuxt/bin/nuxt.mjs', 'build'],
            },
            {
              label: 'packed Nuxt SSR',
              command: process.execPath,
              arguments: ['verify-built.mjs'],
            },
            {
              label: 'packed Nuxt browser typecheck',
              command: process.execPath,
              arguments: ['node_modules/typescript/bin/tsc', '-p', 'browser-tsconfig.json'],
            },
            {
              label: 'packed Nuxt browser navigation',
              command: process.execPath,
              arguments: ['dist-browser/browser.js'],
            },
          ],
        });
      });

      expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/nuxt', '@zmdb/vue']);
      expect(result.commands.map(command => [command.label, command.status])).toEqual([
        ['packed Nuxt build', 0],
        ['packed Nuxt SSR', 0],
        ['packed Nuxt browser typecheck', 0],
        ['packed Nuxt browser navigation', 0],
      ]);
      expect(JSON.parse(result.commands[1]?.stdout ?? '')).toEqual({
        browserChunks: expect.any(Number),
        observations: 2,
        payload: true,
        requests: ['first', 'second'],
      });
      expect(JSON.parse(result.commands[3]?.stdout ?? '')).toEqual({
        calls: ['/api/widgets/navigation'],
        phase: 'client-navigation',
        result: { id: 'navigation', name: 'Browser navigation' },
      });
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
