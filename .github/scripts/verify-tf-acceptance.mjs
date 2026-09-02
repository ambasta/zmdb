#!/usr/bin/env node
// The gate on §6.7 itself: every REQ-TF acceptance criterion has to name something that
// runs, and that thing has to exist.
//
// The type-first requirements are the design goal, and their ACs are prose in PRD.md.
// Prose rots in a specific way here — a test gets renamed, a script gets dropped from
// CI, a row keeps claiming a green that nothing computes any more — and the whole point
// of the section is that it asserts *where* each claim is checked rather than asserting
// the claim. So this reads the table back and checks the citations:
//
//   * every row names at least one enforcer: a `verify:*` script or a spec/type-test file
//   * every file it names resolves, unambiguously, to a file that is actually there
//   * every `verify:*` script it names is a real root script AND runs in ci.yml — a
//     script CI never invokes is a document with a filename
//   * every quoted test title it cites appears in one of the files that row names
//   * the ids are contiguous, and every status marker is one we recognise
//
// It deliberately does not read the requirement text. Whether REQ-TF-6 is *met* is
// `derive/tagged-dto.type-test.ts`'s business; whether §6.7 is telling the truth about
// who to ask is this script's.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HEADING = '### 6.7 Type-first declaration (REQ-TF)';
// A row may report met, or report a ratchet holding a number that is not zero yet. Both
// are enforceable; "planned" is not, which is why it is not in this list.
const STATUS = ['✅', '⚠️'];

let errors = 0;
const fail = message => {
  console.error(`[ERROR] ${message}`);
  errors++;
};

/** Every source/doc file in the repo, for suffix-resolving a citation like `reflect/index.ts`. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|md)$/.test(entry.name)) out.push(path.slice(ROOT.length + 1));
  }
  return out;
}
const FILES = walk(ROOT);

const prd = readFileSync(join(ROOT, 'PRD.md'), 'utf8');
const from = prd.indexOf(HEADING);
if (from === -1) {
  fail(`PRD.md has no "${HEADING}" heading — §6.7 has been renamed or removed`);
  process.exit(1);
}
const body = prd.slice(from + HEADING.length);
const section = body.slice(0, body.search(/\n#{2,4} /));

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

const rows = section.split('\n').filter(line => /^\|\s*\*\*REQ-TF-\d+\*\*/.test(line));
if (rows.length === 0) {
  fail('§6.7 has no REQ-TF rows');
  process.exit(1);
}

const seen = [];
for (const row of rows) {
  // `\|` inside a cell is an escaped pipe (`T \| null`), not a column break. Park it
  // somewhere the split cannot see, and put it back once the cells are apart.
  const PIPE = '\u0000';
  const cells = row.replaceAll('\\|', PIPE).split('|');
  const id = cells[1].replaceAll('*', '').trim();
  const ac = (cells[3] ?? '').replaceAll(PIPE, '|').trim();
  seen.push(Number(id.replace('REQ-TF-', '')));

  if (!STATUS.some(marker => ac.startsWith(marker))) {
    fail(`${id}: the AC does not open with a status marker (${STATUS.join(' or ')}) — it opens "${ac.slice(0, 40)}"`);
  }

  const named = [...ac.matchAll(/`([\w./#@[\]-]+\.(?:ts|tsx|md))`/g)].map(match => match[1]);
  const paths = [];
  for (const citation of named) {
    const matches = FILES.filter(file => file === citation || file.endsWith(`/${citation}`));
    if (matches.length === 0) fail(`${id}: cites \`${citation}\`, which is not a file in this repo`);
    else if (matches.length > 1) {
      fail(`${id}: cites \`${citation}\`, which is ambiguous — ${matches.join(', ')}. Cite a longer path.`);
    } else paths.push(matches[0]);
  }

  const gates = [...ac.matchAll(/`(?:yarn )?(verify:[\w-]+)`/g)].map(match => match[1]);
  for (const gate of new Set(gates)) {
    if (!(gate in scripts)) fail(`${id}: cites \`yarn ${gate}\`, which is not a script in package.json`);
    else if (!ci.includes(`yarn ${gate}`)) fail(`${id}: cites \`yarn ${gate}\`, which ci.yml never runs`);
  }

  const tests = paths.filter(path => /\.(spec|type-test)\.ts$/.test(path));
  if (tests.length === 0 && gates.length === 0) {
    fail(`${id}: the AC names no enforcer — no verify: script, no spec, no type test`);
  }

  // A cited test title is the most fragile citation in the table: renaming an `it()` is a
  // one-line change nobody would think to grep the PRD for.
  const sources = tests.map(path => readFileSync(join(ROOT, path), 'utf8'));
  for (const [, title] of ac.matchAll(/\("([^"]+)"\)/g)) {
    const needle = title.replaceAll('`', '');
    if (!sources.some(source => source.replaceAll('`', '').includes(needle))) {
      fail(`${id}: cites a test named "${title}", which none of ${tests.join(', ') || '(no files cited)'} contains`);
    }
  }
}

const expected = Array.from({ length: seen.length }, (_, i) => i + 1);
if (seen.join(',') !== expected.join(',')) {
  fail(`§6.7's ids are not REQ-TF-1..${seen.length} in order: got ${seen.join(', ')}`);
}

if (errors > 0) {
  console.error(`\n§6.7 acceptance audit failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(`[SUCCESS] ${rows.length} REQ-TF rows, every citation resolves and every gate named runs in CI.`);
