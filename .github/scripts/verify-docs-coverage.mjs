#!/usr/bin/env node
// Checks the claim "zmdb replaces Drizzle, MikroORM, Typia and NestJS" against
// those projects' actual tables of contents.
//
// docs-site/coverage/inventory.mjs is a pinned snapshot of every documentation
// page the four upstream projects publish (396 of them, at the commits recorded
// in that file). docs-site/coverage/mapping.mjs says, for each one, either which
// zmdb page covers it or why we deliberately do not have it.
//
// This script fails when:
//   - an upstream page has no entry in the mapping
//   - the mapping references an upstream page that no longer exists
//   - a mapping target is not a real slug in pages.mjs
//   - an anti-pattern's `see` slug is not a real page
//   - a registered page has no content file
//
// It is deliberately not a percentage. There is no threshold to tune and no
// partial credit: every upstream page is either covered or argued against.
//
// Usage: node .github/scripts/verify-docs-coverage.mjs [--summary]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = join(ROOT, 'docs-site');

const { INVENTORY, SOURCES, TOTAL_UPSTREAM_PAGES } = await import(join(DOCS, 'coverage', 'inventory.mjs'));
const { MAPPING, antiPatterns } = await import(join(DOCS, 'coverage', 'mapping.mjs'));
const { NAV, PAGE_META } = await import(join(DOCS, 'pages.mjs'));

const errors = [];
const fail = msg => errors.push(msg);

// --- the registry itself has to be sound before it can certify anything ------

const contentFiles = new Set(
  readdirSync(join(DOCS, 'content'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3)),
);

const navSlugs = new Set(NAV.flatMap(g => g.pages));

for (const slug of Object.keys(PAGE_META)) {
  if (!contentFiles.has(slug)) fail(`page "${slug}" is in PAGE_META but content/${slug}.md is missing`);
  if (!navSlugs.has(slug)) fail(`page "${slug}" is in PAGE_META but not reachable from NAV`);
}
for (const slug of navSlugs) {
  if (!(slug in PAGE_META)) fail(`NAV lists "${slug}" but it has no PAGE_META entry`);
}
for (const slug of contentFiles) {
  if (!(slug in PAGE_META)) fail(`content/${slug}.md is orphaned — no PAGE_META entry`);
}

// --- inventory <-> mapping ---------------------------------------------------

let covered = 0;
let todo = 0;
let declined = 0;

for (const [source, pages] of Object.entries(INVENTORY)) {
  const table = MAPPING[source];
  if (!table) {
    fail(`inventory has source "${source}" with no mapping table`);
    continue;
  }
  const known = new Set(pages);

  for (const page of pages) {
    if (!(page in table)) {
      fail(`${source}: "${page}" is unmapped — add it to docs-site/coverage/mapping.mjs`);
      continue;
    }
    const target = table[page];
    if (typeof target === 'string') {
      if (!(target in PAGE_META)) {
        fail(`${source}: "${page}" maps to "${target}", which is not a page in pages.mjs`);
        continue;
      }
      covered++;
      if (PAGE_META[target].status === 'todo') todo++;
      if (PAGE_META[target].status === 'wontfix') declined++;
    } else if (target && typeof target === 'object' && target.antiPattern) {
      if (!target.see) {
        fail(`${source}: "${page}" is marked an anti-pattern with no \`see\` page`);
      } else if (!(target.see in PAGE_META)) {
        fail(`${source}: "${page}" anti-pattern points at "${target.see}", which is not a page`);
      }
      if ((target.antiPattern ?? '').length < 80) {
        fail(
          `${source}: "${page}" anti-pattern rationale is ${target.antiPattern.length} chars — ` +
            `it needs to be an argument a reader can disagree with, not a label`,
        );
      }
    } else {
      fail(`${source}: "${page}" has a malformed mapping entry`);
    }
  }

  for (const page of Object.keys(table)) {
    if (!known.has(page)) {
      fail(
        `${source}: mapping has "${page}", which is not in the pinned inventory — ` +
          `re-run refresh-docs-inventory.mjs or drop the entry`,
      );
    }
  }
}

const ap = antiPatterns().length;
const inventoried = Object.values(INVENTORY).reduce((n, p) => n + p.length, 0);

if (inventoried !== TOTAL_UPSTREAM_PAGES) {
  fail(`inventory lists ${inventoried} pages but TOTAL_UPSTREAM_PAGES says ${TOTAL_UPSTREAM_PAGES}`);
}

// --- report -----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`docs coverage: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(
    '\nEvery upstream page must map to a zmdb page or to an anti-pattern rationale.\n' +
      'See docs-site/coverage/mapping.mjs.',
  );
  process.exit(1);
}

// The anti-patterns page renders the out-of-scope list from mapping.mjs at build
// time. Losing the marker would silently publish the page without the list, so
// the gate checks it is still there.
const antiPatternsMd = readFileSync(join(DOCS, 'content', 'anti-patterns.md'), 'utf8');
if (!antiPatternsMd.includes('<!-- generated: coverage/mapping.mjs antiPatterns() -->')) {
  console.error(
    'docs coverage: content/anti-patterns.md no longer contains the generated-list marker,\n' +
      '  so the out-of-scope rationales from coverage/mapping.mjs would not be published.',
  );
  process.exit(1);
}

const todoPages = Object.entries(PAGE_META).filter(([, m]) => m.status === 'todo');
const declinedPages = Object.entries(PAGE_META).filter(([, m]) => m.status === 'wontfix');

console.log(`docs coverage: ${inventoried} upstream pages, all accounted for`);
for (const [key, src] of Object.entries(SOURCES)) {
  const table = MAPPING[key];
  const n = INVENTORY[key].length;
  const apn = Object.values(table).filter(t => typeof t === 'object').length;
  console.log(`  ${src.label.padEnd(12)} ${String(n).padStart(3)} pages  ${apn} out of scope`);
}
console.log(
  `  ${''.padEnd(12)} ${String(covered).padStart(3)} mapped to ${Object.keys(PAGE_META).length} zmdb pages, ` +
    `${ap} argued against`,
);
console.log(
  `  ${''.padEnd(12)} ${String(todoPages.length).padStart(3)} zmdb pages marked TODO ` +
    `(${todo} upstream page(s) land on one)`,
);
// A page marked wontfix is still coverage — the reader gets an answer and an
// alternative — but it is not a promise, so it is counted apart from the roadmap.
console.log(
  `  ${''.padEnd(12)} ${String(declinedPages.length).padStart(3)} zmdb pages marked not planned ` +
    `(${declined} upstream page(s) land on one)`,
);

if (process.argv.includes('--summary')) {
  console.log('\nTODO pages:');
  for (const [slug, m] of todoPages) console.log(`  ${slug.padEnd(34)} ${m.note ?? ''}`);
  console.log('\nNot-planned pages:');
  for (const [slug, m] of declinedPages) console.log(`  ${slug.padEnd(34)} ${m.note ?? ''}`);
}
