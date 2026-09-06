// The builder DSL is gone and cannot come back (plan D2).
//
// A schema was a value: `defineSchema('users', { id: serial().primaryKey(), … })`, ten column
// builders and eight modifiers, with `irFromSchema` walking the result back into the IR that
// every back-end reads. A schema is a type now, `schemaOf<T>()` produces the value, and the
// reflection produces the IR directly. This is the gate that keeps it that way.
//
// It is worth a gate rather than trusting the deletion, because nothing about the old surface was
// wrong on its own terms — it is easy to re-add one builder for one awkward case, and a second
// front-end is exactly the thing the type-first work exists to remove. Two front-ends means two
// answers to "what are this table's columns", and the emitted validator only ever agrees with one
// of them.
//
// Two checks, and they are different in kind:
//
//   1. The **surface**: the packages are imported and their export names read. This is exact
//      rather than syntactic — no regex to fool, no re-export chain to follow by hand, and it
//      catches a builder that comes back through the umbrella without being declared there.
//   2. The **callers**: a syntactic scan for `defineSchema` and `irFromSchema` used as code. Only
//      those two names, because they are the two that cannot collide with anything else. Every
//      other deleted name — `text`, `json`, `unique`, `validate` — is an ordinary identifier that
//      live code uses for other purposes, and check 1 already covers them at the only place they
//      could come from.
//
// Prose is not scanned. Explaining why a removed API was removed is a legitimate thing to write,
// and most of the files that mention `defineSchema` today are the ones that deleted it.
//
// `ALLOWED` is the codemod and its corpora. `scripts/codemod-tagged-schema.mjs` reads the old
// spelling and writes the new one, so it has to name what it reads, and it outlives the API by
// design: a consumer upgrading has a codebase full of `defineSchema` calls long after the library
// stopped exporting it. Its corpora declare the DSL without implementing it — see
// `__fixtures__/legacy-dsl.ts`. A stale entry fails too, the same way the descriptor ratchet's
// does: it would claim the codemod still needs something it does not.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The whole deleted surface: `defineSchema`, the ten builders, the eight modifiers, the two
 * registry functions, `irFromSchema`, and the error class that only `defineSchema` threw. */
const DELETED = new Set([
  'defineSchema',
  'irFromSchema',
  'SchemaError',
  // builders
  'serial',
  'integer',
  'bigint',
  'numeric',
  'text',
  'varchar',
  'boolean',
  'timestamp',
  'json',
  'jsonEnum',
  // modifiers
  'notNull',
  'nullable',
  'primaryKey',
  'unique',
  'references',
  'defaultTo',
  'sensitive',
  // the module-scope schema registry, which only had schemas in it because `defineSchema` put
  // them there
  'getRegisteredSchema',
  'registeredSchemas',
]);

// `validate` is deliberately not in the list above. It was a column modifier
// (`text().validate(rule)`) *and* it is the name of `@zmdb/aot-validator`'s live entry point,
// re-exported by the umbrella. Check 1 would flag the second for being the first.

/** The subpaths a schema used to be built from. Every one is imported and its names read. */
const SURFACES = [
  '@zmdb/schema-core',
  '@zmdb/schema-core/ir',
  '@zmdb/schema-core/openapi',
  '@zmdb/schema-core/derive',
  '@zmdb/schema-core/tags',
  'zmdb',
  'zmdb/ir',
];

const problems = [];

for (const specifier of SURFACES) {
  const module = await import(specifier);
  for (const name of Object.keys(module)) {
    if (DELETED.has(name)) {
      problems.push(`${specifier} exports \`${name}\`, which the builder DSL took with it.`);
    }
  }
}

/**
 * The files allowed to name the old spelling in code: the codemod, the corpora it reads, and the
 * one-shot scripts that filed and closed the issues this work was tracked under.
 */
const ALLOWED = new Set([
  // This gate. It has to name what it forbids.
  '.github/scripts/verify-no-defineschema.mjs',
  'scripts/codemod-tagged-schema.mjs',
  'packages/aot-validator/src/reflect/__fixtures__/legacy-dsl.ts',
  'packages/aot-validator/src/reflect/__fixtures__/codemod-corpus.ts',
  'packages/aot-validator/src/reflect/__fixtures__/codemod-tables.ts',
  'packages/aot-validator/src/reflect/__fixtures__/codemod-refusals.ts',
  // These four posted specific GitHub issues and comments, and the text is hard-coded. It quotes
  // what was filed at the time — `defineSchema` is in the *title* of one of the issues — so
  // editing it would falsify a record rather than fix a reference. They have already run, they
  // are imported by nothing, and none of them can bring a builder back.
  '.github/scripts/gen-subissues.mjs',
  '.github/scripts/close-tier5-issues.mjs',
  '.github/scripts/close-impl-issues.mjs',
  // The docs nav manifest, for one page title: `Codemod: defineSchema → a type`. It is prose, but
  // it is prose that has to be a string because it renders, so the "put it in a comment" advice
  // below does not apply. The name is the term a reader with a codebase full of builder calls
  // searches for, which is the whole reason that page exists.
  'docs-site/pages.mjs',
]);

// The two unambiguous names, anywhere in a file's code: called, declared, imported, or named in a
// string. A string counts because that is how the codemod refers to them and how a script that
// writes issue prose does, and there is no useful line between "a comment about the old API" and
// "a template literal describing the old API to a reader" — both are prose, and prose belongs in
// comments, which are stripped below.
const USED = /\b(?:defineSchema|irFromSchema)\b/;

/**
 * Source with its comments removed, so a header explaining the deletion is not a violation.
 *
 * Deliberately naive: it will also eat the tail of a string containing `//`, and that is
 * acceptable here because the only question asked of the result is whether two specific
 * identifiers appear in it.
 */
function withoutComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
}

/**
 * Every source file in the repository, including ones not yet committed.
 *
 * `--others --exclude-standard` is what makes this a gate rather than a report on the last
 * commit: a builder re-added in a new file is exactly the case worth catching, and it is
 * untracked right up until the moment it lands.
 */
function repositorySources() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.ts', '*.mts', '*.mjs', '*.js'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(file => file.length > 0 && !file.endsWith('.d.ts'));
}

const callers = [];
let scanned = 0;
for (const file of repositorySources()) {
  // `ls-files` reads the index, which still lists a file deleted in the working tree.
  if (!existsSync(join(ROOT, file))) continue;
  scanned++;
  if (USED.test(withoutComments(readFileSync(join(ROOT, file), 'utf8')))) callers.push(file);
}

for (const file of callers) {
  if (!ALLOWED.has(file)) {
    problems.push(`${file} still uses \`defineSchema\` or \`irFromSchema\` as code.`);
  }
}
for (const file of ALLOWED) {
  if (!callers.includes(file)) {
    problems.push(`${file} no longer uses the old spelling. Remove it from ALLOWED.`);
  }
}

console.log(
  `no-defineschema: ${SURFACES.length} published surface(s) checked, ${scanned} source file(s) scanned, ` +
    `${callers.length} file(s) still reading the old spelling (all in ALLOWED).`,
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('A table is declared as a type. `zmdb/tags` is the vocabulary, `schemaOf<T>()` produces');
  console.error('the value the query compiler reads, and the reflection produces the IR — there is no');
  console.error('second front-end, and the point of removing it was that two front-ends give two answers');
  console.error('to the same question while the emitted validator only agrees with one.');
  process.exit(1);
}
console.log('a schema is a type: no builder DSL on any published surface, and no caller outside the codemod.');
