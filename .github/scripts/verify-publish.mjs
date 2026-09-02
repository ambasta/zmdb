#!/usr/bin/env node
// The publish smoke test: pack what would be published, install it into a throwaway
// project, and then both *load* and *typecheck* every subpath from outside the repo.
//
// `verify:exports` cannot do this job, and for a while it looked like it could. It
// imports every subpath under plain `node` — but it does so from the workspace root,
// where `node_modules/@zmdb/schema-core` is a symlink into `packages/`. Node resolves
// the realpath, so the file it loads is not under `node_modules`, and the committed
// manifest's `./src/index.ts` target works. Install the same package for real and it
// does not:
//
//   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is currently
//   unsupported for files under node_modules
//
// Every green check in the repo was compatible with a package that could not be
// imported once installed. That is the class of failure this script exists for, so it
// deliberately does the boring, expensive thing: `npm pack`, extract, resolve from a
// directory that is not this one.
//
// It checks two surfaces, because they fail independently:
//   * runtime — `import(specifier)` in a child process whose cwd is the temp project.
//   * types — a generated consumer module that imports every subpath's types, compiled
//     by `tsc` with no `paths` mapping and no `skipLibCheck`, so a declaration that
//     cannot resolve its own neighbours is an error rather than a surprise later.
//
// Plus one thing neither surface reports: a `.d.ts` whose relative specifiers still end
// in `.ts`. `tsc` substitutes the extension and resolves it anyway, which is why this is
// asserted directly instead of being left to the typecheck to notice.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PACKAGES, ROOT, publishManifest, readManifest } from './lib/publish-manifest.mjs';

// Build-time subpaths reach the compiler on purpose (see `verify-exports.mjs`), so the
// temp project needs the peers a consumer of those would already have.
const PEERS = ['typescript', 'pg', '@types/node', '@types/pg'];

const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

/** Every `.d.ts` under `dir`, recursively. */
function declarations(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return declarations(path);
    return entry.isFile() && entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

let errors = 0;
const fail = message => {
  console.error(`[ERROR] ${message}`);
  errors++;
};

// 1. Build. The gate is self-contained on purpose: a stale `dist` would make this pass
//    against output nobody has any more.
console.log('Building every package (topological)...');
if (run('yarn', ['build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
  console.error('[ERROR] yarn build failed');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'zmdb-publish-'));
const stage = join(tmp, 'stage');
const app = join(tmp, 'app');
mkdirSync(stage, { recursive: true });
mkdirSync(join(app, 'node_modules'), { recursive: true });
writeFileSync(
  join(app, 'package.json'),
  `${JSON.stringify({ name: 'zmdb-publish-smoke', private: true, type: 'module' }, null, 2)}\n`,
);

for (const peer of PEERS) {
  const target = join(ROOT, 'node_modules', peer);
  const link = join(app, 'node_modules', peer);
  mkdirSync(join(link, '..'), { recursive: true });
  try {
    symlinkSync(target, link, 'dir');
  } catch {
    console.log(`  (peer ${peer} not installed at the root; build-time subpaths may not load)`);
  }
}

// 2. Pack each package from a staged copy carrying the *publish* manifest, so `npm pack`
//    applies the real `files` list and `.npmignore` rather than the dev ones.
const specifiers = [];
for (const name of PACKAGES) {
  const pkg = publishManifest(readManifest(name));
  const src = join(ROOT, 'packages', name);
  const dst = join(stage, name);

  cpSync(src, dst, {
    recursive: true,
    dereference: true,
    filter: p => !p.includes(`${join(src, 'node_modules')}`),
  });
  writeFileSync(join(dst, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const packed = run('npm', ['pack', '--json', '--pack-destination', tmp], {
    cwd: dst,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  if (packed.status !== 0) {
    fail(`npm pack failed for ${pkg.name}: ${packed.stderr?.trim()}`);
    continue;
  }
  // `npm pack --json` reports an array on npm 10 and an object keyed by package name on
  // npm 11. Take the one entry either way rather than pinning a shape.
  const report = JSON.parse(packed.stdout);
  const { filename } = Array.isArray(report) ? report[0] : Object.values(report)[0];
  const into = join(app, 'node_modules', pkg.name);
  mkdirSync(into, { recursive: true });
  // The tarball's single root directory is always `package/`.
  const untar = run('tar', ['-xzf', join(tmp, filename), '-C', into, '--strip-components=1']);
  if (untar.status !== 0) {
    fail(`could not extract ${filename}: ${untar.stderr?.trim()}`);
    continue;
  }

  for (const subpath of Object.keys(pkg.exports)) {
    specifiers.push(subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`);
  }
  if (pkg.bin) {
    for (const [command, target] of Object.entries(pkg.bin)) {
      const binPath = join(into, target);
      const source = (() => {
        try {
          return readFileSync(binPath, 'utf8');
        } catch {
          return null;
        }
      })();
      if (source === null) fail(`${pkg.name} bin "${command}" → ${target} is not in the tarball`);
      else if (!source.startsWith('#!')) fail(`${pkg.name} bin "${command}" has no shebang`);
    }
  }
  for (const file of declarations(join(into, 'dist'))) {
    const source = readFileSync(file, 'utf8');
    const stale = [...source.matchAll(/(?:from|import\s*\()\s*['"](\.\.?\/[^'"]*\.tsx?)['"]/g)];
    for (const [, specifier] of stale) {
      fail(`${pkg.name} ships ${file.slice(into.length + 1)} with a source specifier: ${specifier}`);
    }
  }
  console.log(`  installed ${pkg.name} (${Object.keys(pkg.exports).length} subpaths)`);
}

// 3. Load every subpath from the temp project.
writeFileSync(
  join(app, 'smoke.mjs'),
  `${[
    'let failed = 0;',
    `for (const specifier of ${JSON.stringify(specifiers)}) {`,
    '  try {',
    '    await import(specifier);',
    '  } catch (error) {',
    "    console.error(`  import('${specifier}') -> ${error.code ?? ''} ${error.message}`);",
    '    failed++;',
    '  }',
    '}',
    'process.exit(failed > 0 ? 1 : 0);',
  ].join('\n')}\n`,
);
console.log(`Importing ${specifiers.length} subpath(s) from an installed tree...`);
if (run('node', ['smoke.mjs'], { cwd: app, stdio: 'inherit' }).status !== 0) {
  fail('at least one subpath does not import from an installed tree');
}

// 4. Typecheck a consumer against the published declarations.
writeFileSync(
  join(app, 'consumer.ts'),
  `${[
    '// Generated by .github/scripts/verify-publish.mjs. Every published subpath, as a',
    '// consumer sees it: no `paths` mapping, no source in reach, only the shipped .d.ts.',
    ...specifiers.map((specifier, i) => `import type * as ns${i} from '${specifier}';`),
    '',
    `export type Surface = [${specifiers.map((_, i) => `typeof ns${i}`).join(', ')}];`,
  ].join('\n')}\n`,
);
writeFileSync(
  join(app, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext'],
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
console.log('Typechecking a consumer against the published declarations...');
const tsc = run(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], { cwd: app, stdio: 'inherit' });
if (tsc.status !== 0) fail('the published declarations do not typecheck from a consumer project');

if (errors > 0) {
  console.error(`\nPublish verification failed with ${errors} error(s). Tree kept at ${tmp}`);
  process.exit(1);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n[SUCCESS] ${PACKAGES.length} packages pack, install, import and typecheck from outside the repo.`);
