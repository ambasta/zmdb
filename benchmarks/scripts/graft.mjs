// Grafts zmdb into the three upstream benchmark suites checked out under
// benchmarks/upstream/ as git submodules.
//
// Two kinds of change, kept separate on purpose:
//
//   participants/  whole files that are ours. Copied in. No conflict is possible,
//                  so a submodule bump never breaks them.
//   patches/       the minimal edits to upstream's own files — registering the
//                  participant in a list, adding a compile script. Applied with
//                  `git apply --3way`, which survives unrelated drift and fails
//                  loudly on real drift instead of silently half-applying.
//
// None of this is meant to be upstreamed: the participants reach into this
// repository by relative path, which only resolves from inside the submodule
// checkout. Upstreaming would mean publishing and depending on the packages,
// which is a different and much slower feedback loop.
//
// Idempotent: running it twice is a no-op. `--check` reports without writing;
// `--clean` reverts everything so the submodules are pristine again.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(BENCH);

export const SUITES = Object.freeze({
  validation: Object.freeze({
    label: 'validation (moltar/typescript-runtime-type-benchmarks)',
    submodule: 'benchmarks/upstream/typescript-runtime-type-benchmarks',
    participants: 'benchmarks/participants/validation',
    patch: 'benchmarks/patches/typescript-runtime-type-benchmarks.patch',
    // Proof the graft resolved: these must exist in the submodule afterwards.
    expect: Object.freeze(['cases/zmdb/index.ts', 'cases/zmdb-aot/index.ts']),
  }),
  orm: Object.freeze({
    label: 'orm (drizzle-team/drizzle-benchmarks)',
    submodule: 'benchmarks/upstream/drizzle-benchmarks',
    participants: 'benchmarks/participants/orm',
    patch: 'benchmarks/patches/drizzle-benchmarks.patch',
    expect: Object.freeze(['src/zmdb-server-node.ts']),
  }),
  framework: Object.freeze({
    label: 'framework (the-benchmarker/web-frameworks)',
    submodule: 'benchmarks/upstream/web-frameworks',
    participants: 'benchmarks/participants/framework',
    // Purely additive — a new javascript/zmdb/ directory, no upstream file
    // touched — so there is nothing to patch.
    patch: undefined,
    expect: Object.freeze(['javascript/zmdb/entry.ts', 'javascript/zmdb/config.yaml']),
  }),
});

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(args, cwd) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    return { ok: false, out: stderr === '' ? String(error.message) : stderr };
  }
}

export function submodulePresent(suite) {
  const dir = join(ROOT, suite.submodule);
  // A registered-but-uninitialised submodule is an empty directory, which is the
  // failure mode worth distinguishing: it means `--init` was never run, not that
  // the checkout is broken.
  return existsSync(dir) && readdirSync(dir).length > 0;
}

export function initSubmodule(suite) {
  const result = tryGit(['submodule', 'update', '--init', '--depth', '1', suite.submodule], ROOT);
  if (!result.ok) {
    throw new Error(
      `graft: could not initialise ${suite.submodule}.\n${result.out.trim()}\n` +
        'The upstream suites are git submodules; they need network access on first use.',
    );
  }
}

// Recursively list files under a participant tree, as paths relative to it.
function participantFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...participantFiles(abs, join(prefix, entry)));
    else out.push(join(prefix, entry));
  }
  return out;
}

// Directories in the participant tree that upstream does not have a single tracked file
// in — i.e. directories that are wholly ours, so anything in the destination copy of one
// that we did not just put there is a leftover.
//
// Copying is not enough on its own: `cpSync` overwrites and adds, it never removes. A
// participant file that gets renamed or deleted in this repository stays behind in the
// submodule, and since the submodule is not something anyone reads, it stays behind
// indefinitely — still compiled, still registered, still measured. That is how a benchmark
// ends up reporting a number for code that no longer exists here.
function ownedDirectories(suite, files) {
  const cwd = join(ROOT, suite.submodule);
  const dirs = new Set();
  for (const file of files) {
    let dir = dirname(file);
    while (dir !== '.' && dir !== '') {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  // Deepest last, so a parent is examined before its children and the shallowest owned
  // directory is the one that gets removed.
  const owned = [];
  for (const dir of [...dirs].toSorted((a, b) => a.length - b.length)) {
    if (owned.some(parent => dir === parent || dir.startsWith(`${parent}/`))) continue;
    const tracked = tryGit(['ls-files', '--', dir], cwd);
    if (tracked.ok && tracked.out.trim() === '') owned.push(dir);
  }
  return owned;
}

function patchState(suite) {
  if (suite.patch === undefined) return 'none';
  const cwd = join(ROOT, suite.submodule);
  const patch = join(ROOT, suite.patch);
  if (!existsSync(patch)) return 'missing';
  // --reverse --check succeeds only if the patch is already in the tree.
  if (tryGit(['apply', '--reverse', '--check', patch], cwd).ok) return 'applied';
  if (tryGit(['apply', '--check', '--3way', patch], cwd).ok) return 'appliable';
  return 'conflict';
}

export function graft(name, { check = false } = {}) {
  const suite = SUITES[name];
  if (suite === undefined) throw new Error(`graft: unknown suite "${name}"`);

  if (!submodulePresent(suite)) {
    if (check) return { suite: name, status: 'submodule-missing' };
    initSubmodule(suite);
  }

  const from = join(ROOT, suite.participants);
  const into = join(ROOT, suite.submodule);
  const files = participantFiles(from);

  if (!check) {
    // Clear our own directories first, so a file we stopped shipping stops being compiled.
    // Build output inside them goes too; the suite's own compile step puts it back.
    for (const dir of ownedDirectories(suite, files)) rmSync(join(into, dir), { recursive: true, force: true });
    for (const file of files) cpSync(join(from, file), join(into, file), { recursive: true });
  }

  const state = patchState(suite);
  if (state === 'conflict') {
    throw new Error(
      `graft: ${suite.patch} no longer applies to ${suite.submodule}.\n` +
        'The submodule has moved under the patch. Re-create it against the new\n' +
        'upstream: make the edits by hand in the submodule, then\n' +
        `  git -C ${suite.submodule} diff > ${suite.patch}`,
    );
  }
  if (state === 'missing') {
    throw new Error(`graft: ${suite.patch} is referenced by the ${name} suite but does not exist.`);
  }
  if (state === 'appliable' && !check) {
    git(['apply', '--3way', join(ROOT, suite.patch)], into);
  }

  // Verify rather than assume. A silent no-op graft would show up much later as
  // an unexplained missing participant in the results.
  const absent = suite.expect.filter(f => !existsSync(join(into, f)));
  if (!check && absent.length > 0) {
    throw new Error(`graft: ${name} graft did not produce ${absent.join(', ')}`);
  }

  const grafted = absent.length === 0 && (state === 'applied' || state === 'none');

  return {
    suite: name,
    status: check ? (grafted ? 'grafted' : 'not-grafted') : 'grafted',
    files: files.length,
    patch: suite.patch === undefined ? null : relative(ROOT, join(ROOT, suite.patch)),
    patchState: state,
  };
}

export function clean(name) {
  const suite = SUITES[name];
  const cwd = join(ROOT, suite.submodule);
  if (!submodulePresent(suite)) return { suite: name, status: 'submodule-missing' };
  // `checkout .` reverts the patched upstream files; `clean -fd` removes the
  // copied-in participants and any build output they produced.
  tryGit(['checkout', '--', '.'], cwd);
  tryGit(['clean', '-fdx'], cwd);
  return { suite: name, status: 'clean' };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--check') ? 'check' : args.includes('--clean') ? 'clean' : 'graft';
  const named = args.filter(a => !a.startsWith('--'));
  const names = named.length > 0 ? named : Object.keys(SUITES);

  for (const name of names) {
    if (SUITES[name] === undefined) {
      process.stderr.write(`graft: unknown suite "${name}" (have: ${Object.keys(SUITES).join(', ')})\n`);
      process.exit(2);
    }
  }

  let failed = false;
  for (const name of names) {
    try {
      const result = mode === 'clean' ? clean(name) : graft(name, { check: mode === 'check' });
      const patch =
        result.patchState === undefined || result.patchState === 'none' ? '' : ` patch:${result.patchState}`;
      process.stdout.write(`${name.padEnd(10)} ${result.status}${patch}\n`);
      if (result.status === 'submodule-missing' || result.status === 'not-grafted') failed = mode === 'check';
    } catch (error) {
      process.stderr.write(`${name.padEnd(10)} FAILED\n${error.message}\n`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
