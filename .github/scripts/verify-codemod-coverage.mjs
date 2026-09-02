// Every `defineSchema` in this repository converts to a tagged interface — or is on a list
// that says why not.
//
// `defineSchema` is being deleted (plan D2), and the codemod is the whole of the migration
// story: for consumers, and for the several dozen fixtures, examples and benchmarks in here.
// So "the codemod handles our own code" is a property, not a one-off observation, and the
// way a property stays true is that something fails when it stops being.
//
// The failure this guards against is not the codemod breaking — `codemod.spec.ts` covers
// that in detail. It is someone adding a schema the codemod cannot read: a computed table
// name, a column from a helper, an inline call with no binding. Found now it is a two-line
// edit to the schema; found during the D2 deletion it is a file that cannot be migrated at
// all, and the cheapest way out at that point is a hand-written interface that immediately
// starts drifting.
//
// `ALLOWED` is the exception list, keyed by file and matched on the *reason*, not the line —
// line numbers move whenever anything above them is edited, and a guard that fails on
// unrelated edits gets deleted rather than fixed. Adding an entry is allowed; it just has to
// be a deliberate edit with a sentence saying why.

import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Schemas the codemod is permitted to refuse, by file, with the reason each is expected to
 * give. A file may appear once with several reasons; the counts have to match too, so a
 * second unnamed call in a file that already has one is still a failure.
 */
const ALLOWED = {
  // Imports `packages/web/dist/index.js`, which is gitignored build output, so this file
  // cannot be in any program in a fresh checkout — which is also why nothing typechecks it.
  // Plan phase 7c deletes its hand-written descriptors and the `dist` import together.
  'benchmarks/harness/framework/app.ts': ['not part of'],

  // `interface Config` and `const ConfigSchema` in one scope: the interface name the codemod
  // would derive is taken. Renaming is the fix, and it is the file's owner's call to make,
  // not a codemod's.
  'packages/repository/src/typed-methods/typed-writes.spec.ts': ['already declared in scope'],

  // The fixture whose entire purpose is to be refused. Each schema in it is one thing the
  // codemod is supposed to decline rather than guess at, and `codemod.spec.ts` asserts the
  // reason for each. If these ever converted, that spec would be the failure.
  'packages/aot-validator/src/reflect/__fixtures__/codemod-refusals.ts': [
    'expected a literal',
    'unknown column function',
    'already declared in scope',
  ],

  // Declares the tagged `User` and the value `UserSchema` side by side on purpose: the file
  // exists to compare the two derivations, so the name the codemod would pick is taken by
  // the thing it would be compared against. Phase 9 deletes the value halves outright, and
  // with them these two refusals.
  'packages/schema-core/src/derive/type-derivation-tagged.type-test.ts': [
    'already declared in scope',
    'already declared in scope',
  ],

  // Inline `defineSchema(...)` calls with no binding — inside `expect(() => …)`, or as an
  // argument to a helper. There is nothing to name the interface after, and these exist to
  // test the runtime builder's own error paths, which the tagged front-end replaces outright
  // rather than reimplements.
  'packages/schema-core/src/ir/ir.spec.ts': ['not bound to a name'],
  'packages/schema-core/src/openapi/singularization.spec.ts': ['not bound to a name'],
  'packages/schema-core/src/schema-core.spec.ts': ['not bound to a name', 'not bound to a name', 'not bound to a name'],
};

/** A floor, so the check cannot pass by the codemod having converted nothing at all. */
const MINIMUM_CONVERTED = 50;

function trackedTypeScript() {
  return execFileSync('git', ['ls-files', '-z', '*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(file => file.length > 0 && !file.endsWith('.d.ts'));
}

function run(files) {
  const options = { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  const argv = [resolve(ROOT, 'scripts/codemod-tagged-schema.mjs'), '--json', '--quiet', ...files];
  try {
    return JSON.parse(execFileSync(process.execPath, argv, options));
  } catch (error) {
    // A refusal makes the codemod exit non-zero, which is exactly the case this script is
    // here to examine — so the exit status is not the answer, the JSON on stdout is. Only a
    // run that produced no parseable output is a real failure.
    const output = error.stdout;
    if (typeof output === 'string' && output.trim().startsWith('[')) return JSON.parse(output);
    throw error;
  }
}

const results = run(trackedTypeScript());
const converted = results.reduce((total, file) => total + file.converted.length, 0);

/** file → the reasons it was refused for, relative and sorted so the comparison is stable. */
const refusals = {};
for (const result of results) {
  for (const refusal of result.refusals) {
    // `at` is `<abs path>[:<line>]`; the line is deliberately dropped. See the header.
    const file = relative(ROOT, refusal.at.replace(/:\d+$/, ''));
    (refusals[file] ??= []).push(refusal.reason);
  }
}

const problems = [];
for (const [file, reasons] of Object.entries(refusals).toSorted()) {
  const allowed = ALLOWED[file];
  if (!allowed) {
    problems.push(
      `${file} has ${reasons.length} schema(s) the codemod cannot convert:\n` +
        reasons.map(reason => `    - ${reason}`).join('\n'),
    );
    continue;
  }
  const unexpected = reasons.filter(reason => !allowed.some(prefix => reason.includes(prefix)));
  if (unexpected.length > 0) {
    problems.push(
      `${file} was refused for a reason it is not allowed to be:\n${unexpected.map(r => `    - ${r}`).join('\n')}`,
    );
  } else if (reasons.length !== allowed.length) {
    problems.push(`${file} has ${reasons.length} refusal(s); ${allowed.length} are allowed. A new one was added.`);
  }
}

for (const file of Object.keys(ALLOWED)) {
  // A stale exception is its own small lie: it says the codemod cannot do something it can.
  if (!refusals[file]) problems.push(`${file} converts cleanly now. Remove it from ALLOWED.`);
}

if (converted < MINIMUM_CONVERTED) {
  problems.push(`only ${converted} schema(s) converted, expected at least ${MINIMUM_CONVERTED}.`);
}

console.log(`codemod coverage: ${converted} schema(s) converted, ${Object.values(refusals).flat().length} refused`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('Every schema in this repository has to convert: `defineSchema` is being removed and the');
  console.error('codemod is the migration. Either make the schema readable, or add it to ALLOWED with a');
  console.error('sentence saying why it cannot be.');
  process.exit(1);
}
console.log('every schema converts, or is a documented exception.');
