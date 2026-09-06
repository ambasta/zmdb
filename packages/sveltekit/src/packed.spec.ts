import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishCatalog, publishManifest, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const ROOT = join(import.meta.dirname, '../../..');
const PUBLISH_PACKAGES = await publishCatalog(ROOT);
const FIXTURE = join(ROOT, 'fixtures', 'client-adapters', 'sveltekit-packed');
const FIXTURE_FILES = [
  '.npmrc',
  'README.md',
  'client-boundary.mjs',
  'src/app.html',
  'src/lib/navigation.ts',
  'src/routes/+layout.svelte',
  'src/routes/+page.server.ts',
  'src/routes/+page.svelte',
  'src/routes/api/widgets/[id]/+server.ts',
  'src/routes/client/+page.svelte',
  'src/routes/redirected/+page.svelte',
  'svelte.config.js',
  'tsconfig.json',
  'verify-boundary.mjs',
  'verify-runtime.mjs',
  'verify-types.mjs',
  'vite.config.js',
] as const;

function buildPackage(name: '@zmdb/client' | '@zmdb/svelte' | '@zmdb/sveltekit'): void {
  const result = spawnSync('yarn', ['workspace', name, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${name} build failed\n${result.stdout}\n${result.stderr}`);
  }
}

describe('@zmdb/sveltekit packed consumers', () => {
  it(
    'packed SvelteKit fixture builds, renders isolated SSR requests and navigates',
    () => {
      const result = runPackedProject({
        name: '@zmdb-fixture/sveltekit-packed',
        buildLockRoot: ROOT,
        preparePackages() {
          buildPackage('@zmdb/client');
          buildPackage('@zmdb/svelte');
          buildPackage('@zmdb/sveltekit');
        },
        packages: [
          {
            directory: join(ROOT, 'packages', 'client'),
            manifest: publishManifest(readManifest('client', PUBLISH_PACKAGES)),
          },
          {
            directory: join(ROOT, 'packages', 'svelte'),
            manifest: publishManifest(readManifest('svelte', PUBLISH_PACKAGES)),
          },
          {
            directory: join(ROOT, 'packages', 'sveltekit'),
            manifest: publishManifest(readManifest('sveltekit', PUBLISH_PACKAGES)),
          },
        ],
        dependencies: {
          '@sveltejs/kit': '2.70.3',
          svelte: '5.57.0',
        },
        devDependencies: {
          '@sveltejs/adapter-node': '5.5.7',
          '@sveltejs/vite-plugin-svelte': '7.3.0',
          '@types/node': '26.4.1',
          esbuild: '0.28.2',
          typescript: '7.0.2',
          vite: '8.2.2',
        },
        files: {
          ...Object.fromEntries(FIXTURE_FILES.map(path => [path, readFileSync(join(FIXTURE, path), 'utf8')])),
          'src/lib/api.generated.ts': readFileSync(
            join(ROOT, 'fixtures', 'client-adapters', 'src', 'generated', 'api.generated.ts'),
            'utf8',
          ),
        },
        commands: [
          {
            label: 'packed SvelteKit sync',
            command: process.execPath,
            arguments: ['node_modules/@sveltejs/kit/svelte-kit.js', 'sync'],
          },
          {
            label: 'packed SvelteKit public typecheck',
            command: process.execPath,
            arguments: ['verify-types.mjs'],
          },
          {
            label: 'packed SvelteKit build',
            command: process.execPath,
            arguments: ['node_modules/vite/bin/vite.js', 'build'],
          },
          {
            label: 'packed SvelteKit browser boundary',
            command: process.execPath,
            arguments: ['verify-boundary.mjs'],
          },
          {
            label: 'packed SvelteKit SSR and navigation runtime',
            command: process.execPath,
            arguments: ['verify-runtime.mjs'],
          },
        ],
      });

      try {
        expect([...result.tarballs.keys()].toSorted()).toEqual(['@zmdb/client', '@zmdb/svelte', '@zmdb/sveltekit']);
        expect(result.commands.map(command => command.status)).toEqual([0, 0, 0, 0, 0]);
        const boundary: unknown = JSON.parse(result.commands[3]?.stdout.trim() ?? '');
        expect(boundary).toMatchObject({
          browserBytes: expect.any(Number),
        });
        const runtime: unknown = JSON.parse(result.commands[4]?.stdout.trim() ?? '');
        expect(runtime).toEqual({
          browser: 'no-tenant:no-cookie',
          cancellation: true,
          redirects: 307,
          ssr: [200, 200],
          statusError: 418,
        });
      } finally {
        result.cleanup();
      }
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
