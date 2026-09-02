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
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

rmSync(join(pkgDir, 'dist'), { recursive: true, force: true });

const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
const res = spawnSync(tsc, ['-p', 'tsconfig.build.json'], { cwd: pkgDir, stdio: 'inherit' });
if (res.status !== 0) {
  process.stderr.write(`\n${pkg.name}: tsc exited ${res.status}\n`);
  process.exit(res.status ?? 1);
}

// `rewriteRelativeImportExtensions` rewrites the JavaScript and leaves the
// declarations alone, so a shipped `.d.ts` still says `from './errors.ts'` —
// naming a file that exists in `src` and not in `dist`. A consumer's `tsc` does
// not notice, because it tries `./errors.d.ts` when `./errors.ts` is missing and
// finds it; nothing else that reads a `.d.ts` is obliged to be that generous, and
// either way a declaration should not be describing its neighbours wrongly.
//
// Fixing it here rather than in the source is deliberate: the source specifiers
// have to stay `.ts`, because that is what Node resolves when it runs the source
// directly — which the tests, the dev loop and the consumer fixtures all do.
const REL_TS = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]*)\.tsx?\2/g;

/** @param {string} dir @returns {string[]} */
function declarations(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return declarations(p);
    return e.isFile() && e.name.endsWith('.d.ts') ? [p] : [];
  });
}

let rewritten = 0;
for (const file of declarations(join(pkgDir, 'dist'))) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(REL_TS, (_m, kw, q, spec) => `${kw}${q}${spec}.js${q}`);
  if (after !== before) {
    writeFileSync(file, after);
    rewritten++;
  }
}

process.stdout.write(`${pkg.name}: dist built, ${rewritten} declaration file(s) had .ts specifiers rewritten\n`);
