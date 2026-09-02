// REQ-TF-11: checker cost is paid once per build, not once per file.
//
// The AOT path's whole economy rests on this. Loading a TypeScript project — reading the
// config, walking the import graph, binding every file — is the expensive part; asking the
// checker what one type argument is afterwards is a cheap round-trip to an already-warm
// process. A tool that opened a session per module would spend more producing the compiled
// validator than the validator ever saves, and it would still pass every correctness test in
// the repository. So the requirement is about *shape*, and this measures the shape.
//
// ---------------------------------------------------------------------------
// The deterministic part, which is the real gate
// ---------------------------------------------------------------------------
//
// Two counts, neither of them a clock:
//
//   - **One `API` instance for the whole run.** `reflect/session.ts` counts every compiler
//     server this process has started, and a 64-module build has to move that counter by
//     exactly one. `plugin.spec.ts` already asserts this for the bundler path; the CLI —
//     which is the path that sees whole projects rather than one module at a time — had
//     nothing watching it.
//   - **Snapshot updates do not grow with the file count.** This is the sharper one, and it
//     is what "not once per file" actually means. `ReflectSession` logs every update, so the
//     same project is generated at 8 modules and at 64 and the two logs must be *identical*.
//     Telling the compiler about a file is a re-check; doing it per generated witness would
//     make a hundred-file project a hundred re-checks, which is why `cli/index.ts` writes
//     every witness before transforming any of them. That ordering is load-bearing and reads
//     like an arbitrary choice, so this is the test that fails if somebody tidies it.
//
// Both are exact integers, reproducible on any machine, and both would survive a rewrite of
// everything else in this file.
//
// The second row has been mutation-tested against the regression it exists for. Moving the two
// `session.created` / `session.refresh` calls inside the witness-writing loop — one line, and
// it reads like a tidy-up — takes the count from 2 to 65 and fails both deterministic rows.
// That mutation moved the *clock* from 6.0ms to 8.2ms per module, comfortably inside any ceiling
// a shared runner would tolerate, which is the argument for the deterministic rows in one
// number.
//
// ---------------------------------------------------------------------------
// The clock, and what it is allowed to decide
// ---------------------------------------------------------------------------
//
// REQ-TF-11's criterion also asks for a *published* build-time measurement, so the numbers are
// printed: opening the project, generating on top of it, checking an already-generated tree, and
// the marginal cost of a module. Only the last is a gate, and a loose one — a CI runner is a
// shared VM, and a threshold tight enough to catch a 20% regression would fail on a noisy
// neighbour instead.
//
// What the split shows is worth stating, because it is not quite the intuitive story. Opening
// the project is ~20ms and does not grow with the file count, because the compiler defers the
// expensive work until something asks it a question — so "the fixed cost dominates" is false
// here, and the honest claim is the one the requirement actually makes: the load is paid once.
// The per-module 6ms is real work, four derivations and a diagnostics query per witness, and it
// is linear. A build that reopened the project per file would pay the ~20ms again each time,
// which is what the two rows above forbid.
//
// The measurement runs the real `codegen()`, on a generated project inside the repository so
// that `zmdb` resolves the way it does for a consumer, and the artifacts it writes are the
// ones `zmdb-codegen` would write. `.budget/` is gitignored and removed in a `finally`.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codegen } from '../../packages/aot-validator/src/cli/index.ts';
import { apiInstanceCount, ReflectSession } from '../../packages/aot-validator/src/reflect/session.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = resolve(ROOT, '.budget');

/** The build to publish a number for, and the smaller one its update log is compared against. */
const MODULES = 64;
const SMALL = 8;

/**
 * The two deterministic budgets. Both were 1 and 2 when this was written.
 *
 * `exact` because there is no such thing as headroom in the first one — a build opens one
 * compiler or it has misunderstood the assignment. The second gets a ceiling rather than an
 * equality only so that a third legitimate update (a codegen that grew a phase) is a decision
 * somebody makes rather than a wall they hit; what stops it drifting is the separate check that
 * the log is identical at 8 modules and at 64, which no ceiling can be loosened past.
 */
const BUDGET = {
  apiInstances: { limit: 1, exact: true, what: 'compiler API instances opened by one build' },
  snapshotUpdates: { limit: 3, exact: false, what: 'snapshot updates for the whole build' },
};

/** Wall-time ceiling per module, in milliseconds. Measured at 6.0; loose on purpose. */
const MS_PER_MODULE = 25;

// ---------------------------------------------------------------------------
// The project
// ---------------------------------------------------------------------------

const TSCONFIG = {
  compilerOptions: {
    target: 'ESNext',
    lib: ['ESNext'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
  },
  include: ['src/**/*.ts'],
};

/**
 * One module: a tagged interface and four derivations of it.
 *
 * Four rather than one because the witness is per *file* and the point of the exercise is a
 * file with real work in it. `toJsonSchema` is in there deliberately — it is the derivation
 * that walks the whole type rather than emitting a predicate, so a module that only called
 * `is` would understate the checker traffic.
 */
function module_(index) {
  return `import { assert, is, toJsonSchema, validate } from 'zmdb';
import type { JsonSchemaObject, ValidateResult } from 'zmdb';
import type { Length, Min, MinLength, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface Row${index} extends Table<'row_${index}'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly reference: string & Sql<'varchar'> & Length<${32 + index}> & MinLength<6> & Unique;
  readonly total: number & Sql<'integer'> & Min<${index}>;
  readonly status: 'pending' | 'shipped' | 'cancelled';
  readonly note: (string & Sql<'text'>) | null;
}

export function accepts${index}(value: unknown): boolean {
  return is<Row${index}>(value);
}

export function insist${index}(value: unknown): Row${index} {
  return assert<Row${index}>(value);
}

export function explain${index}(value: unknown): ValidateResult<Row${index}> {
  return validate<Row${index}>(value);
}

export function document${index}(): JsonSchemaObject {
  return toJsonSchema<Row${index}>();
}
`;
}

/** Write a project of `modules` files and hand back its `tsconfig.json`. */
function project(name, modules) {
  const directory = resolve(SCRATCH, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(resolve(directory, 'src'), { recursive: true });
  writeFileSync(
    resolve(directory, 'package.json'),
    `${JSON.stringify({ name: `@zmdb-budget/${name}`, type: 'module', private: true }, undefined, 2)}\n`,
  );
  writeFileSync(resolve(directory, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, undefined, 2)}\n`);
  for (let index = 0; index < modules; index++) {
    writeFileSync(resolve(directory, 'src', `row-${index}.ts`), module_(index));
  }
  return resolve(directory, 'tsconfig.json');
}

/** Open a project, run one `codegen` on the session, and hand back the session's own numbers. */
function pass(tsconfig, options) {
  const before = apiInstanceCount();
  const openedAt = performance.now();
  const session = ReflectSession.open({ project: tsconfig });
  const opened = performance.now() - openedAt;
  try {
    const startedAt = performance.now();
    const result = codegen({ ...options, project: tsconfig, session });
    return {
      result,
      opened,
      elapsed: performance.now() - startedAt,
      apiInstances: apiInstanceCount() - before,
      updates: [...session.updates],
    };
  } finally {
    session.close();
  }
}

/**
 * Generate for one project, then check it, and report what each cost.
 *
 * The session is passed in rather than left to `codegen` so the update log is observable —
 * which is the whole reason `CodegenOptions.session` exists.
 *
 * The check runs on a *second* session, because that is what a rebuild is: a new invocation of
 * the binary. Reusing the first one does not work and the reason is worth knowing — `codegen`
 * rewrites the source files it read, so by the time it returns, the snapshot the session is
 * holding is stale and the next pass correctly refuses with "changed on disk since the project
 * loaded". Doing this on two sessions is also what makes the check's own log meaningful: a
 * clean tree gives `['open']` and nothing else, so `--check` in CI costs a project load and no
 * re-checks at all.
 */
function build(name, modules) {
  const tsconfig = project(name, modules);

  const generate = pass(tsconfig);
  // A run that refused is not a measurement of anything: a refusal skips the transform, so a
  // broken fixture would read as a fast build.
  if (!generate.result.ok) {
    throw new Error(
      `the generated ${modules}-module project did not build:\n  ${generate.result.problems.join('\n  ')}`,
    );
  }

  // Every artifact is now on disk and current, so a check has to come back with nothing to say.
  // If it does not, the generator is not a pure function of its input.
  const check = pass(tsconfig, { check: true });
  if (!check.result.ok) {
    throw new Error(
      'a check straight after a successful generate found work to do, so the generator is not ' +
        `deterministic:\n  ${[...check.result.written, ...check.result.deleted, ...check.result.problems].join('\n  ')}`,
    );
  }

  return {
    modules,
    apiInstances: generate.apiInstances,
    updates: generate.updates,
    checkUpdates: check.updates,
    written: generate.result.written.length,
    opened: generate.opened,
    generated: generate.elapsed,
    checked: check.elapsed,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let big;
let small;
try {
  // The small one first: it warms nothing that matters — each build spawns its own compiler
  // server — but it does pay whatever one-off cost Node has for loading the emitter, and the
  // published number should be the one that is not carrying that.
  small = build('small', SMALL);
  big = build('big', MODULES);
} finally {
  if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });
}

const values = {
  apiInstances: big.apiInstances,
  snapshotUpdates: big.updates.length,
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const pad = (text, width) => String(text).padStart(width);
const ms = value => `${value.toFixed(0)}ms`;

/**
 * `[open, refresh, refresh, …]` sixty-four times over is not a diagnostic, it is a wall of
 * text with the answer buried in it. Runs are collapsed to `refresh ×64`, which is the shape
 * the reader is looking for.
 */
const log = updates => {
  const runs = [];
  for (const update of updates) {
    const last = runs.at(-1);
    if (last?.kind === update) last.count++;
    else runs.push({ kind: update, count: 1 });
  }
  return runs.map(({ kind, count }) => (count === 1 ? kind : `${kind} ×${count}`)).join(', ');
};

console.log(`build budget: \`codegen\` over a generated ${MODULES}-module project\n`);
console.log('  measurement                                                        value    ceiling');
for (const [key, { limit, exact, what }] of Object.entries(BUDGET)) {
  const value = values[key];
  const bad = exact ? value !== limit : value > limit;
  console.log(
    `  ${bad ? '✗' : ' '} ${what.padEnd(62)} ${pad(value, 7)} ${pad(exact ? `= ${limit}` : `<= ${limit}`, 10)}`,
  );
}

console.log(`\n  the snapshot update log, which must not depend on the file count:`);
console.log(`    ${SMALL} modules: [${log(small.updates)}]`);
console.log(`    ${MODULES} modules: [${log(big.updates)}]`);
console.log(`    ${MODULES} modules, --check on a clean tree: [${log(big.checkUpdates)}]`);

console.log('\n  published build time              modules   open project      generate        check');
for (const one of [small, big]) {
  console.log(
    `  ${'codegen'.padEnd(32)} ${pad(one.modules, 7)} ${pad(ms(one.opened), 14)} ${pad(ms(one.generated), 13)} ${pad(ms(one.checked), 12)}`,
  );
}
const perModule = (big.generated - small.generated) / (MODULES - SMALL);
console.log(
  `\n  marginal cost of a module: ${perModule.toFixed(1)}ms (ceiling ${MS_PER_MODULE}ms), ` +
    `against ${ms(big.opened)} to open the project once`,
);
console.log(`  artifacts written: ${big.written} for ${MODULES} modules`);

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const problems = [];
if (values.apiInstances !== 1) {
  problems.push(
    `a ${MODULES}-module build opened ${values.apiInstances} compiler API instance(s), not 1. ` +
      'Each one spawns a server and loads the project from scratch, which is the cost REQ-TF-11 ' +
      'exists to keep paying once.',
  );
}
if (values.snapshotUpdates > BUDGET.snapshotUpdates.limit) {
  problems.push(
    `the build performed ${values.snapshotUpdates} snapshot updates, ceiling ${BUDGET.snapshotUpdates.limit}. ` +
      'A snapshot update re-checks files, so a build that does one per generated witness scales ' +
      'with the project instead of with the change.',
  );
}
if (small.updates.join(',') !== big.updates.join(',')) {
  problems.push(
    `the update log depends on the number of files: ${SMALL} modules gave [${log(small.updates)}] and ` +
      `${MODULES} gave [${log(big.updates)}]. "Once per build, not once per file" is exactly this ` +
      'comparison — `cli/index.ts` writes every witness before transforming any of them for this reason.',
  );
}
if (perModule > MS_PER_MODULE) {
  problems.push(
    `${perModule.toFixed(1)}ms per module, ceiling ${MS_PER_MODULE}ms. This ceiling is loose enough that ` +
      'hitting it means a structural change rather than a slow runner — look for work that moved ' +
      'inside the per-file loop.',
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `\none compiler session, ${values.snapshotUpdates} snapshot updates whatever the file count, ` +
    `${perModule.toFixed(1)}ms per module.`,
);
