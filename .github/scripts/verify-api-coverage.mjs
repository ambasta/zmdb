#!/usr/bin/env node
// Checks the claim "zmdb replaces Drizzle, Kysely, MikroORM, NestJS and Typia" against those
// projects' test suites, rather than against their tables of contents.
//
// verify-docs-coverage.mjs already answers "do we document what they document". This answers the
// harder one: "do we test what they test". A documented feature is a promise; a tested one is a
// behaviour someone's code depends on, and it is the second list that says whether a migration
// would actually survive.
//
// tests/api-coverage/inventory.mjs is a pinned harvest of 760 upstream functional-test suites
// covering 9,290 assertions. tests/api-coverage/mapping.mjs says, for each one, either which zmdb
// test asserts the same behaviour or why we deliberately do not have it.
//
// This script fails when:
//   - an upstream suite has no mapping entry
//   - a mapping entry names a zmdb test title that does not exist in any *.spec.ts
//   - a mapping pattern matches no upstream suite (a stale entry after a re-harvest)
//   - an out-of-scope rationale is shorter than 80 chars or points at a docs slug that is not real
//   - the inventory's own totals disagree with its rows
//
// Like the docs gate it is deliberately not a percentage: every upstream suite is either covered
// by a named test or argued against in prose. There is no threshold to tune.
//
// What it cannot check is how *much* one zmdb test is being asked to carry. Upstream trees are full
// of families that are one behaviour written out N times, so a wide entry is often the truer
// mapping — but a test credited for sixty suites is a weaker claim than the same test credited for
// two, and no assertion here can tell those apart. The widest credits are printed on every run so
// that the thin end of the claim stays visible instead of averaging into the totals.
//
// Usage: node .github/scripts/verify-api-coverage.mjs [--summary]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERAGE = join(ROOT, 'tests', 'api-coverage');

const { INVENTORY, SOURCES, TOTAL_UPSTREAM_SUITES, TOTAL_UPSTREAM_ASSERTIONS } = await import(
  join(COVERAGE, 'inventory.mjs')
);
const { MAPPING, outOfScope } = await import(join(COVERAGE, 'mapping.mjs'));
const { PAGE_META } = await import(join(ROOT, 'docs-site', 'pages.mjs'));

const errors = [];
const fail = msg => errors.push(msg);

// --- the zmdb side: every test title a mapping entry is allowed to name ------
//
// Extracted statically rather than by running vitest, because the gate has to be able to say
// "this mapping points at a test that no longer exists" without a database to hand.

const TITLE = /^[ \t]*(?:it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/gm;

function specFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) specFiles(full, out);
    else if (entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** title -> the spec files asserting it. */
const zmdbTests = new Map();
for (const file of specFiles(join(ROOT, 'packages'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(TITLE)) {
    const title = m[2].replace(/\\(['"`])/g, '$1');
    if (title.includes('${')) continue; // an interpolated title is not a stable name to cite
    if (!zmdbTests.has(title)) zmdbTests.set(title, []);
    zmdbTests.get(title).push(relative(ROOT, file));
  }
}

// --- inventory <-> mapping ---------------------------------------------------

/** `*` matches any run of characters. Specificity is how much of the key is literal. */
const toRegExp = pattern =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, ch => (ch === '*' ? '[\\s\\S]*' : `\\${ch}`))}$`);

const stats = { covered: 0, argued: 0, coveredAssertions: 0, arguedAssertions: 0 };
/** The titles a mapping entry actually names. Not the size of the repo's suite: the number
 *  that matters is how many distinct tests carry the coverage claim, and it is much smaller. */
const credited = new Set();
/** zmdb test title -> how many upstream suites lean on it. */
const fanIn = new Map();
const perSource = {};
const gaps = [];

for (const [source, suites] of Object.entries(INVENTORY)) {
  const table = MAPPING[source];
  if (!table) {
    fail(`inventory has source "${source}" with no mapping table`);
    continue;
  }

  // Exact keys win over patterns; among patterns, the most literal one wins. Without that a
  // catch-all `*` would quietly absorb rows a narrower entry was written for.
  const patterns = Object.keys(table)
    .filter(k => k.includes('*'))
    .map(k => ({ key: k, re: toRegExp(k), weight: k.replace(/\*/g, '').length }))
    .toSorted((a, b) => b.weight - a.weight);
  const used = new Set();
  const mine = (perSource[source] = { suites: 0, assertions: 0, out: 0 });

  for (const [suite, assertions] of Object.entries(suites)) {
    mine.suites++;
    mine.assertions += assertions;
    let key = suite in table ? suite : patterns.find(p => p.re.test(suite))?.key;
    if (key === undefined) {
      gaps.push(`${source}: ${suite}`);
      fail(`${source}: "${suite}" is unmapped — add it to tests/api-coverage/mapping.mjs`);
      continue;
    }
    used.add(key);
    const target = table[key];

    if (typeof target === 'string' || Array.isArray(target)) {
      const titles = Array.isArray(target) ? target : [target];
      if (titles.length === 0) fail(`${source}: "${suite}" maps to an empty list of tests`);
      let ok = true;
      for (const title of titles) {
        if (!zmdbTests.has(title)) {
          ok = false;
          fail(
            `${source}: "${suite}" maps to a zmdb test called "${title}", which no *.spec.ts ` +
              `declares — rename the mapping or the test`,
          );
        }
      }
      if (ok) {
        stats.covered++;
        stats.coveredAssertions += assertions;
        for (const title of titles) {
          credited.add(title);
          fanIn.set(title, (fanIn.get(title) ?? 0) + 1);
        }
      }
    } else if (target && typeof target === 'object' && target.outOfScope) {
      if (!target.see) {
        fail(`${source}: "${suite}" is out of scope with no \`see\` page`);
      } else if (!(target.see in PAGE_META)) {
        fail(`${source}: "${suite}" out-of-scope note points at "${target.see}", which is not a docs page`);
      }
      if (target.outOfScope.length < 80) {
        fail(
          `${source}: "${suite}" out-of-scope rationale is ${target.outOfScope.length} chars — ` +
            `it needs to be an argument a reader can disagree with, not a label`,
        );
      }
      stats.argued++;
      stats.arguedAssertions += assertions;
      mine.out++;
    } else {
      fail(`${source}: "${suite}" has a malformed mapping entry`);
    }
  }

  for (const key of Object.keys(table)) {
    if (!used.has(key)) {
      fail(
        `${source}: mapping has "${key}", which matches nothing in the pinned inventory — ` +
          `re-run scripts/harvest-api-tests.mjs or drop the entry`,
      );
    }
  }
}

for (const source of Object.keys(MAPPING)) {
  if (!(source in INVENTORY)) fail(`mapping has source "${source}" with no inventory`);
}

const rows = Object.values(INVENTORY).reduce((n, s) => n + Object.keys(s).length, 0);
const assertions = Object.values(INVENTORY).reduce((n, s) => n + Object.values(s).reduce((m, c) => m + c, 0), 0);
if (rows !== TOTAL_UPSTREAM_SUITES) {
  fail(`inventory lists ${rows} suites but TOTAL_UPSTREAM_SUITES says ${TOTAL_UPSTREAM_SUITES}`);
}
if (assertions !== TOTAL_UPSTREAM_ASSERTIONS) {
  fail(`inventory counts ${assertions} assertions but TOTAL_UPSTREAM_ASSERTIONS says ${TOTAL_UPSTREAM_ASSERTIONS}`);
}

// --- report -----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`api coverage: ${errors.length} problem(s)\n`);
  for (const e of errors.slice(0, 60)) console.error(`  ✗ ${e}`);
  if (errors.length > 60) console.error(`  … and ${errors.length - 60} more`);
  console.error(
    '\nEvery upstream test suite must map to a zmdb test or to an out-of-scope rationale.\n' +
      'See tests/api-coverage/mapping.mjs.',
  );
  process.exit(1);
}

console.log(`api coverage: ${rows} upstream suites (${assertions} assertions), all accounted for`);
for (const [key, src] of Object.entries(SOURCES)) {
  const { suites, assertions: a, out } = perSource[key];
  console.log(
    `  ${src.label.padEnd(12)} ${String(suites).padStart(4)} suites ${String(a).padStart(5)} assertions  ` +
      `${String(out).padStart(3)} out of scope  (${src.unit})`,
  );
}
console.log(
  `  ${''.padEnd(12)} ${String(stats.covered).padStart(4)} covered by ${credited.size} of the ` +
    `${zmdbTests.size} zmdb tests, ${stats.argued} argued against`,
);
console.log(
  `  ${''.padEnd(12)} ${String(stats.coveredAssertions).padStart(4)} upstream assertions covered, ` +
    `${stats.arguedAssertions} out of scope`,
);
console.log(`  ${''.padEnd(12)} ${outOfScope().length} distinct rationales`);

const widest = [...fanIn].toSorted((a, b) => b[1] - a[1]).slice(0, 3);
console.log(`  ${''.padEnd(12)} widest credits: ${widest.map(([t, n]) => `${n}x "${t}"`).join(', ')}`);

if (process.argv.includes('--summary')) {
  console.log('\nUnmapped:');
  for (const g of gaps) console.log(`  ${g}`);
}
