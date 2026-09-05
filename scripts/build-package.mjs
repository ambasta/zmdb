#!/usr/bin/env node
// Build one package into `dist/`: ESM JavaScript, declarations, and both maps.
//
// This used to be tsup, and tsup cannot do it any more. Its declaration step is
// `rollup-plugin-dts`, which reads `ts.sys` / `ts.createProgram` off the
// `typescript` package — the JS compiler API that TypeScript 7 does not ship.
// `require('typescript')` there resolves to this repo's 7.0.2 and yields an
// object with two keys, so the plugin dies on `ts2.sys.useCaseSensitiveFileNames`
// before it has looked at a single file. That is not a configuration problem and
// no version of tsup fixes it.
//
// So the compiler that already typechecks the repo emits it too. That loses
// bundling and chunk splitting, which this package never needed: `dist` mirrors
// `src` one file at a time, every relative import still resolves, and each
// `exports` subpath is the same path with `src`/`.ts` swapped for `dist`/`.js`
// (which is what `.github/scripts/repoint-dist.mjs` relies on).
//
// Nothing here post-processes the output. It used to: the source wrote its
// relative imports as `./errors.ts`, `rewriteRelativeImportExtensions` fixed the
// JavaScript and left the declarations naming a file that only exists in `src`,
// so a pass over `dist/**/*.d.ts` repaired them. The source says `./errors.js`
// now, so `tsc` emits the right specifier into both halves and there is nothing
// left to repair.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

rmSync(join(pkgDir, 'dist'), { recursive: true, force: true });

const yarnCmd = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const res = spawnSync(yarnCmd, ['tsc', '-p', 'tsconfig.build.json'], { cwd: pkgDir, stdio: 'inherit' });
if (res.status !== 0) {
  process.stderr.write(`\n${pkg.name}: tsc exited ${res.status}\n`);
  process.exit(res.status ?? 1);
}

// `@zmdb/compiler` writes executable JavaScript beside a checked TypeScript witness.
// TypeScript follows the sibling `.d.ts` while compiling but does not copy either
// checked-in file to `outDir`, so a package source that imports its generated module
// would otherwise build an import whose target is absent. Preserve those generated
// pairs at the same relative path; ordinary authored JavaScript is still not copied.
function copyGenerated(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) {
      copyGenerated(source);
      continue;
    }
    if (!entry.name.endsWith('.zmdb.generated.js') && !entry.name.endsWith('.zmdb.generated.d.ts')) continue;
    const target = join(pkgDir, 'dist', source.slice(join(pkgDir, 'src').length + 1));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

copyGenerated(join(pkgDir, 'src'));

process.stdout.write(`${pkg.name}: dist built\n`);
