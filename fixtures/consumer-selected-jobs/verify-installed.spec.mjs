import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { inspectInstalledConsumer, ROOTS } from './verify-installed.mjs';

const packageNames = ['@zmdb/core', '@zmdb/jobs', '@zmdb/jobs-sqlite', '@zmdb/jobs-postgres', '@zmdb/app', 'pg'];

async function fixture(lane, change, inspect) {
  const root = await mkdtemp(join(resolve(import.meta.dirname, '../../..'), 'selected-jobs-controls-'));
  try {
    const packages = { '': { dependencies: Object.fromEntries(ROOTS[lane].map(name => [name, '1.0.0'])) } };
    const integrities = new Map(packageNames.map(name => [name, `sha512-${name}`]));
    for (const name of ROOTS[lane]) {
      const location = `node_modules/${name}`;
      await mkdir(join(root, location, 'dist'), { recursive: true });
      await writeFile(join(root, location, 'dist/index.js'), 'export {};\n');
      await writeFile(
        join(root, location, 'package.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          type: 'module',
          exports: { '.': { import: './dist/index.js' } },
          ...(name.startsWith('@zmdb/jobs-') ? { peerDependencies: { '@zmdb/jobs': '1.0.0' } } : {}),
        }),
      );
      packages[location] = { version: '1.0.0', integrity: integrities.get(name) };
    }
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module', dependencies: packages[''].dependencies }),
    );
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages }));
    await change({ root, packages, integrities });
    await inspect(root, integrities);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const lane of Object.keys(ROOTS)) {
  await test(`[RF757-C01] ${lane} installed-tree setup accepts its declared roots`, async () => {
    await fixture(
      lane,
      async () => {},
      async (root, integrities) => {
        const result = await inspectInstalledConsumer(root, lane, integrities);
        assert.equal(result.lane, lane);
        assert.deepEqual(result.directDependencies, ROOTS[lane]);
      },
    );
  });
}

await test('[RF757-C02] refuses a default install coupled to jobs', async () => {
  await fixture(
    'default',
    async ({ root }) => {
      const path = join(root, 'package.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      manifest.dependencies['@zmdb/jobs'] = '1.0.0';
      await writeFile(path, JSON.stringify(manifest));
    },
    async (root, integrities) => {
      await assert.rejects(inspectInstalledConsumer(root, 'default', integrities), /consumer direct dependencies/);
    },
  );
});

await test('[RF757-C03] refuses a wrong installed tarball integrity', async () => {
  await fixture(
    'default',
    async ({ root, packages }) => {
      packages['node_modules/@zmdb/core'].integrity = 'sha512-wrong';
      await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages }));
    },
    async (root, integrities) => {
      await assert.rejects(
        inspectInstalledConsumer(root, 'default', integrities),
        /wrong tarball integrity @zmdb\/core/,
      );
    },
  );
});

await test('[RF757-C04] refuses resolution into a workspace package', async () => {
  await fixture(
    'default',
    async ({ root }) => {
      await rm(join(root, 'node_modules/@zmdb/core'), { recursive: true });
      await symlink(join(import.meta.dirname, '../../packages/zmdb'), join(root, 'node_modules/@zmdb/core'));
    },
    async (root, integrities) => {
      await assert.rejects(
        inspectInstalledConsumer(root, 'default', integrities),
        /installed package escapes consumer/,
      );
    },
  );
});

await test('[RF757-C05] refuses a missing selected provider', async () => {
  await fixture(
    'sqlite',
    async ({ root }) => {
      await rm(join(root, 'node_modules/@zmdb/jobs-sqlite'), { recursive: true });
    },
    async (root, integrities) => {
      await assert.rejects(inspectInstalledConsumer(root, 'sqlite', integrities), /selected provider closure/);
    },
  );
});

await test('[RF757-C06] refuses an optional jobs peer in a provider declaration', async () => {
  await fixture(
    'sqlite',
    async ({ root }) => {
      const path = join(root, 'node_modules/@zmdb/jobs-sqlite/package.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      manifest.peerDependenciesMeta = { '@zmdb/jobs': { optional: true } };
      await writeFile(path, JSON.stringify(manifest));
    },
    async (root, integrities) => {
      await assert.rejects(
        inspectInstalledConsumer(root, 'sqlite', integrities),
        /provider requires an explicit jobs peer/,
      );
    },
  );
});
