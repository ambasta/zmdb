import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

// The four barriers around the module inspector. Tests freeze for the epic "The module graph as a
// first-class object" (#598 / spec freeze #599); the frozen text is
// `packages/web/src/devtools/SPEC.md` §9 and §10.11, and `packages/zmdb/src/cli/SPEC.md` §R7.13.
//
// DoD 6 of the epic asks that the inspector not be importable into a production request path
// "enforced, not documented", and §9 answers with four independent barriers: a separate `./devtools`
// subpath, a REPL that lives in the `zmdb` CLI rather than in `@zmdb/web`, the generic runtime
// reachability gate (with `yarn verify:devtools-boundary` retained as a compatibility command), and
// a runtime TTY refusal. This file is about the third, and about the two manifest facts the first
// two consist of.
//
// §10.11 asks that the gate fail on a planted inspector import and pass on the committed tree.
// The oracle below uses overlays so all three plants are tested without mutating the workspace:
//
// - The *oracle* is written here, once, as `reachesInspector` — the walk §9.3 specifies, over the
//   real workspace, with an overlay so a plant can be tried without writing to the tree. Three green
//   tests plant the three violations §9 and §R7.13 name and require that the walk finds each. Those
//   are green on purpose and the reason is worth stating: a walk that reports nothing on a clean tree
//   and would also report nothing on a dirty one asserts nothing at all, and the two halves of
//   §10.11 are only worth as much as each other. They pin the oracle so that the slice which lands
//   the real `.mjs` has something to be checked against, and they break if the walk stops following
//   `@zmdb/*` across package boundaries or stops matching bare side-effect imports.
// - The *tree as committed* is green, and stays a live assertion for as long as the repository does.
// - The gate, subpath and CI wiring are asserted as repository facts.
//
// The walk is a local copy of `.github/scripts/verify-exports.mjs`'s `importsOf`,
// `resolveSpecifier` and `pathToTypescript` (`:145-173`), which §9.3 names as the shape to copy —
// deliberately a copy and not an import, because that file is a script with top-level side effects
// (it walks every package and calls `process.exit`) and importing it would run the export gate as a
// side effect of this spec file. The duplication is named here so that the slice landing the real
// `.mjs` extracts one walker rather than writing a third.
//
// Every recorded actual in this file came from running the walk, not from reading the manifests by
// eye.

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');
const DEVTOOLS_DIR = join(PACKAGES_DIR, 'web', 'src', 'devtools');

/** The two packages a consumer installs, which are the only entry points §9.3 walks from. */
const GUARDED_PACKAGES: readonly string[] = ['@zmdb/web', 'zmdb'];

/** The three tool-only subpaths allowed to reach the inspector. */
const EXEMPT_ENTRIES: ReadonlySet<string> = new Set(['@zmdb/web#./devtools', 'zmdb#./cli', 'zmdb#./web/devtools']);

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly exports: Readonly<Record<string, unknown>>;
}

/**
 * Every workspace package, by name.
 *
 * `@zmdb/*` is followed across the package boundary rather than stopped at, for the reason
 * `verify-exports.mjs` gives: the umbrella package is the one consumers actually import, so a guard
 * that gave up at the boundary would miss the only import graph that matters. §9.1 says as much
 * about `packages/zmdb/src/web.ts` specifically — "that last one is where this rule gets broken
 * first".
 */
function workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
  const found = new Map<string, WorkspacePackage>();
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = join(PACKAGES_DIR, entry.name);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) {
      continue;
    }
    const record: { name?: unknown; exports?: unknown } = manifest;
    if (typeof record.name !== 'string') {
      continue;
    }
    const exportsMap: Readonly<Record<string, unknown>> =
      typeof record.exports === 'object' && record.exports !== null ? record.exports : {};
    found.set(record.name, { name: record.name, dir, exports: exportsMap });
  }
  return found;
}

const WORKSPACE = workspacePackages();

/**
 * The file a specifier points at, or `null` when it leaves the workspace.
 *
 * The `.js` -> `.ts` mapping is the one place this copy departs from
 * `.github/scripts/verify-exports.mjs:145-156`, and it is not an improvement in passing — it is the
 * difference between a gate and a decoration. Every relative import in this repository names its
 * sibling as `./x.js` (`../di/index.js`, `../lifecycle.js`), and `join(dirname(file), './x.js')` is a
 * path that does not exist, so the existing walker's queue drops it and the walk ends. Measured, by
 * running both forms over `packages/web/src/index.ts`: **1 file reached** without this mapping and
 * **37 with it**. A gate copied from `pathToTypescript` as §9.3 suggests would therefore see only the
 * entry file's own imports, and the plant §10.11 asks it to catch — one line in
 * `packages/web/src/app/index.ts`, two hops from the root entry — would be invisible to it.
 *
 * `verify-exports.mjs` gets away with it because its final check imports every subpath under
 * `node --import ./scripts/ts-specifier-hook.mjs`, which does this resolution properly at run time,
 * so the shallow walk is not the only thing standing between that gate and a mistake. There is no
 * equivalent second check here: reaching `src/devtools/` is not a load failure, so the walk is the
 * whole gate. This is recorded as a follow-up against `verify:exports`'s own reachability check,
 * which is weaker than it reads for the same reason.
 */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const path = join(dirname(file), specifier);
    if (existsSync(path) && !path.endsWith(sep)) {
      return path;
    }
    const sibling = path.endsWith('.js') ? `${path.slice(0, -'.js'.length)}.ts` : `${path}.ts`;
    if (existsSync(sibling)) {
      return sibling;
    }
    const barrel = join(path, 'index.ts');
    return existsSync(barrel) ? barrel : path;
  }
  const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(\/.*)?$/.exec(specifier);
  const target = match === null ? undefined : WORKSPACE.get(match[1] ?? '');
  if (target === undefined || match === null) {
    return null;
  }
  const entry = target.exports[`.${match[2] ?? ''}`];
  return typeof entry === 'string' ? join(target.dir, entry) : null;
}

/** How many files a walk from `entry` actually visits — the number the mapping above is about. */
function reachCount(entry: string): number {
  const seen = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    for (const { resolved } of importsOf(file, readFileSync(file, 'utf8'))) {
      if (resolved !== null) {
        queue.push(resolved);
      }
    }
  }
  return seen.size;
}

/** Every import and re-export specifier in `source`, static and dynamic. */
function importsOf(file: string, source: string): readonly { specifier: string; resolved: string | null }[] {
  const specifiers: string[] = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier ?? '');
  }
  // The bare side-effect form, which the export gate has no reason to match and this one does:
  // `import '@zmdb/web/devtools'` has no clause and no `from`, and it is enough to pull the module
  // into a bundle. §10.11's planted line is written with a clause, but a plant is a mistake and a
  // mistake takes the shortest form available.
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
  }
  return specifiers.map(specifier => ({ specifier, resolved: resolveSpecifier(file, specifier) }));
}

/** A specifier or resolved path that reaches the inspector or a REPL, per §9.1 and §9.2. */
function isViolation(specifier: string, resolved: string | null): boolean {
  if (specifier === 'node:repl' || specifier.startsWith('node:repl/')) {
    return true;
  }
  // The subpath does not resolve today — `packages/web/package.json` has no `./devtools` entry, which
  // is one of the red assertions below — so the specifier has to be matched by name as well as by
  // the path it would resolve to once it exists. A gate that only checked resolved paths would pass
  // the planted import for as long as the subpath was missing, which is exactly the window in which
  // someone writes it.
  if (/^@zmdb\/web\/devtools(\/|$)/.test(specifier) || /^zmdb\/devtools(\/|$)/.test(specifier)) {
    return true;
  }
  return resolved !== null && !relative(DEVTOOLS_DIR, resolved).startsWith('..');
}

/**
 * The chain from `entry` to the first file that reaches the inspector, or `null`.
 *
 * `overlay` replaces a file's contents without touching the disk, which is how a plant is tried in a
 * repository this spec must not write to. Breadth-first, so the chain reported is a shortest one and
 * a failure message names the shortest route rather than an arbitrary one.
 */
function reachesInspector(entry: string, overlay: ReadonlyMap<string, string>): readonly string[] | null {
  const seen = new Set<string>();
  const queue: string[][] = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift() ?? [];
    const file = chain.at(-1) ?? '';
    if (seen.has(file)) {
      continue;
    }
    const source = overlay.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    if (source === undefined) {
      continue;
    }
    seen.add(file);
    for (const { specifier, resolved } of importsOf(file, source)) {
      if (isViolation(specifier, resolved)) {
        return [...chain, specifier];
      }
      if (resolved !== null) {
        queue.push([...chain, resolved]);
      }
    }
  }
  return null;
}

/** `name#subpath` for every guarded production entry point. */
function guardedEntries(): readonly { readonly id: string; readonly file: string }[] {
  const entries: { id: string; file: string }[] = [];
  for (const name of GUARDED_PACKAGES) {
    const pkg = WORKSPACE.get(name);
    expect(pkg, `${name} is a workspace package`).toBeDefined();
    for (const [subpath, target] of Object.entries(pkg?.exports ?? {})) {
      if (typeof target !== 'string') {
        continue;
      }
      const id = `${name}#${subpath}`;
      if (EXEMPT_ENTRIES.has(id)) {
        continue;
      }
      entries.push({ id, file: join(pkg?.dir ?? '', target) });
    }
  }
  return entries;
}

/** Every guarded entry that reaches the inspector, as `id: a -> b -> specifier`. */
function violations(overlay: ReadonlyMap<string, string> = new Map()): readonly string[] {
  return guardedEntries().flatMap(({ id, file }) => {
    const chain = reachesInspector(file, overlay);
    return chain === null ? [] : [`${id}: ${chain.map(step => relative(ROOT, step) || step).join(' -> ')}`];
  });
}

const NO_OVERLAY: ReadonlyMap<string, string> = new Map();

describe('the devtools boundary', () => {
  // Green, and it is half of §10.11. It holds today because `src/devtools/` contains only `SPEC.md`
  // and two test files, and it is the assertion that goes red the first time a controller, a
  // middleware or `packages/zmdb/src/web.ts` reaches for the inspector. Sixteen entry points are
  // walked (fifteen `@zmdb/web` subpaths, `./devtools` excluded once it exists, plus ten `zmdb`
  // ones); the count is not asserted, because a new subpath is a normal thing to add and having to
  // edit this number would be the wrong kind of friction.
  it('is not crossed by any @zmdb/web or zmdb entry point on the tree as committed', () => {
    expect(violations()).toEqual([]);
  });

  // Green, and the walk has to be deeper than one file for it to mean anything. This is the number
  // behind `resolveSpecifier`'s note, asserted so that a later simplification back to the existing
  // walker's shape fails here with the reason on the screen rather than silently emptying the gate.
  // A lower bound rather than the exact 37, because adding a module to `@zmdb/web` is a normal thing
  // to do and this is not the file that should have an opinion about it; the bound is set well above
  // 1, which is the answer the unmodified walker gives.
  it('follows relative .js specifiers to their .ts siblings', () => {
    expect(reachCount(join(PACKAGES_DIR, 'web', 'src', 'index.ts'))).toBeGreaterThan(20);
  });

  // Green, and it is the other half of §10.11 — the planted line, verbatim from §9's closing
  // paragraph, in the file §10.11 names. Green rather than red because what it pins is the *oracle*:
  // the walk above reports nothing today, and a walk that would also report nothing here is not a
  // check. Two ways for it to fail, and both are mistakes a real gate would make: `isViolation`
  // stops matching the subpath by name (which makes the gate useless for exactly as long as
  // `./devtools` is missing from the export map, the window in which someone writes the line), or
  // the walk stops following relative specifiers and never gets from the root entry to `app/`.
  //
  // The assertion is made against the root entry `@zmdb/web#.` and not against `@zmdb/web#./app`,
  // deliberately: the plant is *in* the app entry, so a one-file-deep walk finds it from `#./app`
  // and would be indistinguishable from a working gate. From `#.` it is two hops, which is the
  // shape a real mistake has.
  it('catches a planted @zmdb/web/devtools import two hops from the root entry', () => {
    const planted = join(PACKAGES_DIR, 'web', 'src', 'app', 'index.ts');
    const overlay = new Map([
      [planted, `import { describeGraph } from '@zmdb/web/devtools';\n${readFileSync(planted, 'utf8')}`],
    ]);
    const found = violations(overlay).filter(line => line.startsWith('@zmdb/web#.:'));
    expect(found).toEqual([
      `@zmdb/web#.: packages/web/src/index.ts -> ${relative(ROOT, planted)} -> @zmdb/web/devtools`,
    ]);
  });

  // §R7.13's plant, in the file §9.1 says the rule gets broken in first. Green for the same reason
  // as the test above. Two things make this the interesting plant rather than a repeat: it is a
  // re-export (`export { ... } from`) rather than an import, and it is reached only by following
  // `zmdb#./web` into another package — so it fails if the walk stops at the package boundary.
  it('catches a planted inspector re-export from the zmdb umbrella package', () => {
    const planted = join(PACKAGES_DIR, 'zmdb', 'src', 'web.ts');
    const overlay = new Map([
      [planted, `${readFileSync(planted, 'utf8')}\nexport { describeGraph, renderDot } from '@zmdb/web/devtools';\n`],
    ]);
    expect(violations(overlay)).toContain(`zmdb#./web: ${relative(ROOT, planted)} -> @zmdb/web/devtools`);
  });

  // §9.2's second half: `node:repl` is a violation wherever it appears on a reachable path, not only
  // under `src/devtools/`. The bare side-effect form is used here because it is the form with the
  // least syntax around it and therefore the one a specifier regex is likeliest to miss.
  it('catches a planted node:repl import in the app entry', () => {
    const planted = join(PACKAGES_DIR, 'web', 'src', 'app', 'index.ts');
    const overlay = new Map([[planted, `import 'node:repl';\n${readFileSync(planted, 'utf8')}`]]);
    expect(violations(overlay)).toContain(`@zmdb/web#./app: ${relative(ROOT, planted)} -> node:repl`);
  });

  // §9.2's claim stated over the whole package rather than over reachable paths: "`node:repl` appears
  // nowhere under `packages/web/src`". Green today.
  //
  // Asserted over import specifiers in `.ts` files and not by grepping the tree, and that is not
  // fussiness: `packages/web/src/devtools/SPEC.md` contains the string `node:repl` in its own prose,
  // four times, so a text search over the directory reports a violation against the sentence that
  // forbids it. A gate written the quick way would have to be weakened or exempted the day it was
  // written, and this is the shape it has to have instead.
  it('has no node:repl specifier anywhere under packages/web/src', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts')) {
          const reached = importsOf(path, readFileSync(path, 'utf8'));
          if (reached.some(({ specifier }) => specifier === 'node:repl' || specifier.startsWith('node:repl/'))) {
            offenders.push(relative(ROOT, path));
          }
        }
      }
    };
    walk(join(PACKAGES_DIR, 'web', 'src'));
    expect(offenders).toEqual([]);
  });

  // §9.1's second half, and green today for a reason that will not last: the file's stated habit is
  // to enumerate every public symbol (`packages/zmdb/src/web.ts:1-2`), so the inspector's four names
  // are exactly what an author following that habit adds next. This is the line that says they are
  // the exception. Asserted on the re-export list as text rather than by importing the module,
  // because importing it would resolve `@zmdb/web` and prove only that the names are absent from a
  // module that cannot have them yet.
  it('does not re-export the inspector from the zmdb umbrella package', () => {
    const source = readFileSync(join(PACKAGES_DIR, 'zmdb', 'src', 'web.ts'), 'utf8');
    const named = ['describeGraph', 'dependentsOf', 'renderTree', 'renderDot'].filter(name =>
      new RegExp(`\\b${name}\\b`).test(source),
    );
    expect(named).toEqual([]);
  });

  // §9.1's first half. The metadata readers are library surface used by the later inspector slice,
  // and `lazy` is the declaration marker. Keep all three reachable through the umbrella.
  it('re-exports lazy and the two metadata readers from the zmdb umbrella package', () => {
    const source = readFileSync(join(PACKAGES_DIR, 'zmdb', 'src', 'web.ts'), 'utf8');
    const named = ['lazy', 'moduleDefOf', 'injectionsOf'].filter(name =>
      new RegExp(`^\\s*${name},$`, 'm').test(source),
    );
    expect(named).toEqual(['lazy', 'moduleDefOf', 'injectionsOf']);
  });

  // §9.1's first barrier: the subpath itself.
  it('publishes ./devtools as a separate @zmdb/web subpath', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGES_DIR, 'web', 'package.json'), 'utf8'));
    const record: { exports?: Record<string, unknown> } = Object(manifest);
    expect(record.exports?.['./devtools']).toBe('./src/devtools/index.ts');
  });

  it('publishes ./web/devtools as a separate zmdb product subpath', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGES_DIR, 'zmdb', 'package.json'), 'utf8'));
    const record: { exports?: Record<string, unknown> } = Object(manifest);
    expect(record.exports?.['./web/devtools']).toBe('./src/web-devtools.ts');
  });

  // §9.1's other half of the first barrier, and the one that is not a manifest fact: nothing under
  // `src/devtools/` may be reachable from `src/index.ts`.
  it('keeps the inspector out of the @zmdb/web root entry once it exists', () => {
    const inspector = join(DEVTOOLS_DIR, 'index.ts');
    const state = existsSync(inspector) ? 'present' : 'devtools/index.ts is absent';
    expect([state, reachesInspector(join(PACKAGES_DIR, 'web', 'src', 'index.ts'), NO_OVERLAY)]).toEqual([
      'present',
      null,
    ]);
  });

  // §9.3's third barrier. The two halves are separate because they fail independently.
  it('ships the gate as .github/scripts/verify-devtools-boundary.mjs', () => {
    const present = ['verify-devtools-boundary.mjs'].filter(name => existsSync(join(ROOT, '.github', 'scripts', name)));
    expect(present).toEqual(['verify-devtools-boundary.mjs']);
  });

  it('wires the gate to yarn verify:devtools-boundary', () => {
    // §9.3 puts repository gates in `.github/scripts/`; `verify:fixtures` is the package-bin
    // exception.
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const record: { scripts?: Record<string, unknown> } = Object(manifest);
    expect(record.scripts?.['verify:devtools-boundary']).toBe('node .github/scripts/verify-devtools-boundary.mjs');
  });

  // The generic gate has to be *run*, not merely present. The old command remains callable for
  // downstream compatibility, while CI owns one policy-driven reachability decision.
  it('runs the generic reachability gate in CI', () => {
    const workflow = join(ROOT, '.github', 'workflows', 'ci.yml');
    const source = existsSync(workflow) ? readFileSync(workflow, 'utf8') : '';
    const found = source.includes('verify:runtime-reachability')
      ? 'verify:runtime-reachability'
      : 'no verify:runtime-reachability step';
    expect(found).toBe('verify:runtime-reachability');
  });
});
