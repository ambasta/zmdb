// No hand-written `TypeDescriptor` anywhere in this repository (REQ-TF-9).
//
// A descriptor is the shape of a type, written out a second time by hand, in a form the
// compiler cannot check against the type it claims to describe. Every one of them is a
// copy that starts drifting the moment the interface it mirrors is edited, and the drift is
// silent: the validator keeps passing, it just stops checking the field somebody added.
//
// The replacement is `TypeIR`, which is generated — by `Reflector` from a declared type, or by
// the codegen CLI over a whole file. The count is now zero and the descriptor path is gone
// with it: `TypeDescriptor`, `RuntimeSchema` and the `irFromDescriptor` bridge are deleted, and
// every entry point takes `TypeIR` and nothing else. So the job of this script has changed from
// ratcheting a number down to holding it at zero.
//
// Three signals, all on code rather than prose so a comment discussing descriptors is not a
// failure:
//
//   1. an object literal with a `fields:` key — the one key a descriptor had and the IR
//      does not (the IR spells the same thing `properties`, as an array);
//   2. an import of the `TypeDescriptor` name — you cannot annotate what you cannot name;
//   3. a *declaration* of that name. This was excluded while the type still existed, because
//      the declaration site was legitimate. Nothing declares it now, and a file that starts
//      to is how the shape would come back.
//
// `ALLOWED` is empty, and the loop that reads it is kept for the shape of the failure rather
// than for any entry: it names the file and the count, which is what you want to see if a
// descriptor is ever reintroduced with a plausible-looking reason.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * file → how many hand-written descriptors it is allowed to contain.
 *
 * Empty, and it should stay that way. It held four specs that tested the legacy front-end
 * itself, which is the only honest reason to write the input form; they now build a `TypeIR`
 * because there is no other form to build.
 */
const ALLOWED = {};

// A descriptor object literal. The IR's object node has `properties`, an array, so this
// key is unambiguous.
const LITERAL = /\bfields\s*:\s*\{/g;
// `import { … TypeDescriptor … }` / `import type { TypeDescriptor }`, single- or
// multi-line. A comment mentioning the name is not one.
const IMPORTED = /\bimport\s+(?:type\s+)?\{[^}]*\bTypeDescriptor\b[^}]*\}/g;
// `interface TypeDescriptor` / `type TypeDescriptor =` — the shape coming back by declaration
// rather than by import. Nothing declares it now, which is what makes this checkable.
const DECLARED = /\b(?:interface|type)\s+TypeDescriptor\b/g;

function trackedTypeScript() {
  return execFileSync('git', ['ls-files', '-z', '*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(file => file.length > 0 && !file.endsWith('.d.ts') && !file.endsWith('.generated.ts'));
}

/** file → count, for every file that authors at least one descriptor. */
const found = {};
let scanned = 0;
for (const file of trackedTypeScript()) {
  // `ls-files` reads the index, which still lists a file deleted in the working tree. A
  // file that is gone authors nothing.
  if (!existsSync(join(ROOT, file))) continue;
  const source = readFileSync(join(ROOT, file), 'utf8');
  scanned++;
  const literals = source.match(LITERAL)?.length ?? 0;
  const named = (source.match(IMPORTED)?.length ?? 0) + (source.match(DECLARED)?.length ?? 0);
  // A file that names the type but writes no literal still counts as one use: it is either
  // annotating something with the hand-written form or bringing the form back.
  const uses = literals > 0 ? literals : named;
  if (uses > 0) found[file] = uses;
}

const problems = [];
for (const [file, uses] of Object.entries(found).toSorted()) {
  const allowed = ALLOWED[file];
  if (allowed === undefined) {
    problems.push(`${file} writes ${uses} hand-written descriptor(s). Generate the witness instead.`);
  } else if (uses !== allowed) {
    problems.push(`${file} writes ${uses} descriptor(s); ${allowed} are allowed. One was added.`);
  }
}
for (const file of Object.keys(ALLOWED)) {
  if (!found[file]) problems.push(`${file} no longer writes a descriptor. Remove it from ALLOWED.`);
}

const total = Object.values(found).reduce((sum, n) => sum + n, 0);
console.log(
  `descriptor ratchet: ${scanned} file(s) scanned, ${total} hand-written descriptor(s) in ${Object.keys(found).length} file(s)`,
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('A descriptor is the shape of a type written out again by hand, and the compiler cannot');
  console.error('check it against the type it describes. Derive a `TypeIR` instead: `Reflector.typeIR`');
  console.error('for a type, `Reflector.schemaIR` for a table, or the codegen CLI for a whole file.');
  process.exit(1);
}
console.log('nothing authors a descriptor, and nothing declares the type — the shape is gone, not fenced off.');
