// No hand-written `TypeDescriptor` anywhere in this repository (REQ-TF-9).
//
// A descriptor is the shape of a type, written out a second time by hand, in a form the
// compiler cannot check against the type it claims to describe. Every one of them is a
// copy that starts drifting the moment the interface it mirrors is edited, and the drift is
// silent: the validator keeps passing, it just stops checking the field somebody added.
//
// The replacement is `TypeIR`, which is generated — by `Reflector`, by `irFromSchema`, or
// by the codegen CLI. So this is a ratchet, not a style rule: the descriptor path still
// exists (`irFromDescriptor` converts it, and shipped code accepts `RuntimeSchema`), and
// what has to stay true is that nothing in here *authors* one.
//
// Two signals, both on code rather than prose so a comment discussing descriptors is not a
// failure:
//
//   1. an object literal with a `fields:` key — the one key a descriptor has and the IR
//      does not (the IR spells the same thing `properties`, as an array);
//   2. an import of the `TypeDescriptor` name — you cannot annotate what you cannot name,
//      and the declaration itself lives in `utilities/index.ts` and is not imported there.
//
// `ALLOWED` is the exception list, keyed by file with the number of descriptors each is
// permitted. The entries in it are the specs that test the descriptor path *as such* —
// `irFromDescriptor` has to keep working, and the only way to test a legacy front-end is to
// use it. A stale entry fails too: it would claim a descriptor is still needed somewhere it
// is not.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * file → how many hand-written descriptors it is allowed to contain. These four test the
 * legacy front-end itself: `irFromDescriptor` is a shipped conversion, and a test for it
 * has to write the input form. Nothing outside this list may.
 */
const ALLOWED = {
  // `validate` against a descriptor, for the issue paths a nested descriptor produces.
  'packages/aot-validator/src/advanced/error-paths.spec.ts': 2,
  // `assertStringify(value, descriptor)` — the descriptor overload of the entry point.
  'packages/aot-validator/src/serialization/assert-stringify.spec.ts': 1,
  // `decode(text, descriptor)` — same, for the parse direction.
  'packages/aot-validator/src/serialization/decode.spec.ts': 1,
  // The `irFromDescriptor` conversion table: every descriptor field, mapped to its IR node.
  'packages/aot-validator/src/utilities/utilities.spec.ts': 1,
};

// A descriptor object literal. The IR's object node has `properties`, an array, so this
// key is unambiguous.
const LITERAL = /\bfields\s*:\s*\{/g;
// `import { … TypeDescriptor … }` / `import type { TypeDescriptor }`, single- or
// multi-line. Only imports: the declaration site is not one, and neither is a comment.
const IMPORTED = /\bimport\s+(?:type\s+)?\{[^}]*\bTypeDescriptor\b[^}]*\}/g;

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
  const imports = source.match(IMPORTED)?.length ?? 0;
  // A file that imports the name but writes no literal still counts as one use: it is
  // annotating something with the hand-written form.
  const uses = literals > 0 ? literals : imports;
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
  console.error('check it against the type it describes. Derive a `TypeIR` instead: `irFromSchema(schema)`');
  console.error('for a schema, `Reflector.typeIR` for a type, or the codegen CLI for a whole file.');
  process.exit(1);
}
console.log('nothing authors a descriptor outside the specs that test the descriptor path.');
