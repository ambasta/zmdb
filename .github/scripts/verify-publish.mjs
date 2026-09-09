#!/usr/bin/env node
// Build the release artifacts, pack the canonical publish manifests, and exercise
// every public entry from one ordinary npm installation outside the workspace.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ROOT, publishCatalog, publishManifest, readManifest } from './lib/publish-manifest.mjs';

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });

function requireSuccess(label, result) {
  if (result.status === 0) return;
  const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
  throw new Error(`${label} failed${detail === '' ? '' : `:\n${detail}`}`);
}

function installedVersion(name) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string') throw new Error(`installed peer ${name} has no version`);
  return manifest.version;
}

const packages = await publishCatalog(ROOT);
const publishedNames = new Set(packages.map(packageRecord => packageRecord.npmName));
const peers = [
  ...new Set([
    ...packages.flatMap(packageRecord => Object.keys(packageRecord.manifest.peerDependencies ?? {})),
    '@types/node',
    '@types/pg',
    '@types/react',
    '@sveltejs/vite-plugin-svelte',
    'server-only',
  ]),
]
  .filter(name => !publishedNames.has(name))
  .toSorted();

console.log('Building publishable packages...');
requireSuccess('package build', run(process.execPath, ['scripts/build-workspaces.mjs']));

const temporaryRoot = mkdtempSync(join(tmpdir(), 'zmdb-publish-'));
const stageRoot = join(temporaryRoot, 'stage');
const tarballRoot = join(temporaryRoot, 'tarballs');
const consumerRoot = join(temporaryRoot, 'consumer');
mkdirSync(stageRoot, { recursive: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(consumerRoot, { recursive: true });

try {
  const tarballs = new Map();
  const specifiers = [];

  for (const packageRecord of packages) {
    const manifest = publishManifest(readManifest(packageRecord.id, packages));
    const source = join(ROOT, packageRecord.directory);
    const stage = join(stageRoot, packageRecord.id);
    cpSync(source, stage, {
      recursive: true,
      dereference: true,
      filter: path => !path.startsWith(join(source, 'node_modules')),
    });
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const packed = run('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
      stdio: 'pipe',
    });
    requireSuccess(`npm pack ${manifest.name}`, packed);
    const report = JSON.parse(packed.stdout);
    const record = Array.isArray(report) ? report[0] : Object.values(report)[0];
    tarballs.set(manifest.name, join(tarballRoot, record.filename));

    for (const subpath of Object.keys(manifest.exports)) {
      specifiers.push(subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`);
    }
  }

  const dependencies = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]));
  for (const peer of peers) dependencies[peer] = installedVersion(peer);
  writeFileSync(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'zmdb-publish-smoke',
        private: true,
        type: 'module',
        dependencies,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Installing ${String(packages.length)} packed packages into one external consumer...`);
  // This aggregate combines independent framework peer sets: SvelteKit accepts
  // TypeScript 5/6 while the CLI requires TypeScript 7. Their focused consumers own
  // peer compatibility; this smoke installs the exact versions already used here.
  requireSuccess(
    'npm install',
    run('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
      cwd: consumerRoot,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    }),
  );

  const nextServer = '@zmdb/next/server';
  const ordinarySpecifiers = specifiers.filter(specifier => specifier !== nextServer);
  writeFileSync(
    join(consumerRoot, 'imports.mjs'),
    `let failures = 0;
for (const specifier of ${JSON.stringify(ordinarySpecifiers)}) {
  try {
    await import(specifier);
  } catch (error) {
    console.error(\`import(\${specifier}) failed: \${error?.stack ?? error}\`);
    failures++;
  }
}
process.exitCode = failures === 0 ? 0 : 1;
`,
  );
  console.log(`Importing ${String(ordinarySpecifiers.length)} installed public entries...`);
  requireSuccess('installed public-entry imports', run(process.execPath, ['imports.mjs'], { cwd: consumerRoot }));

  if (specifiers.includes(nextServer)) {
    const guarded = run(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(nextServer)})`],
      { cwd: consumerRoot, stdio: 'pipe' },
    );
    if (
      guarded.status === 0 ||
      !guarded.stderr.includes('This module cannot be imported from a Client Component module')
    ) {
      throw new Error(`${nextServer} did not enforce its plain-node server guard`);
    }
    requireSuccess(
      `${nextServer} react-server import`,
      run(
        process.execPath,
        ['--conditions=react-server', '--input-type=module', '--eval', `await import(${JSON.stringify(nextServer)})`],
        { cwd: consumerRoot, stdio: 'pipe' },
      ),
    );
  }

  const exceptionSpecifiers = specifiers.filter(
    specifier =>
      specifier === '@zmdb/compiler/metro' || specifier === '@zmdb/nuxt' || specifier.startsWith('@zmdb/nuxt/'),
  );
  const strictSpecifiers = specifiers.filter(specifier => !exceptionSpecifiers.includes(specifier));
  writeFileSync(
    join(consumerRoot, 'consumer.ts'),
    `${strictSpecifiers
      .map((specifier, index) => `import type * as entry${String(index)} from '${specifier}';`)
      .join('\n')}
export type PublishedSurface = [${strictSpecifiers.map((_, index) => `typeof entry${String(index)}`).join(', ')}];
`,
  );
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          types: ['node'],
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );
  console.log('Typechecking installed public declarations...');
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
  requireSuccess('installed declaration typecheck', run(tsc, ['-p', 'tsconfig.json'], { cwd: consumerRoot }));

  if (exceptionSpecifiers.length > 0) {
    writeFileSync(
      join(consumerRoot, 'upstream-types.ts'),
      `${exceptionSpecifiers
        .map((specifier, index) => `import type * as entry${String(index)} from '${specifier}';`)
        .join('\n')}
export type UpstreamSurface = [${exceptionSpecifiers.map((_, index) => `typeof entry${String(index)}`).join(', ')}];
`,
    );
    writeFileSync(
      join(consumerRoot, 'tsconfig.upstream.json'),
      `${JSON.stringify(
        {
          extends: './tsconfig.json',
          compilerOptions: { skipLibCheck: true },
          include: ['upstream-types.ts'],
        },
        null,
        2,
      )}\n`,
    );
    requireSuccess(
      'Metro/Nuxt declaration typecheck',
      run(tsc, ['-p', 'tsconfig.upstream.json'], { cwd: consumerRoot }),
    );
  }

  rmSync(temporaryRoot, { recursive: true, force: true });
  console.log(`[SUCCESS] ${String(packages.length)} packages pack, install, import, and typecheck.`);
} catch (error) {
  console.error(`[ERROR] ${error instanceof Error ? error.stack : String(error)}`);
  console.error(`Publish smoke retained at ${temporaryRoot}`);
  process.exit(1);
}
