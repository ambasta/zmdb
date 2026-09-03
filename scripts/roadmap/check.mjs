// Checks the roadmap data against the docs site before anything is filed: every `todo` page is claimed
// by exactly one epic, every page named by an epic exists, every `blockedBy` resolves, and no two issues
// would be created with the same title. Filing 200-odd issues against bad data is not something you want
// to discover halfway through.

import { PAGE_META } from '../../docs-site/pages.mjs';
import { EPICS } from './epics/index.mjs';

const problems = [];
const note = message => problems.push(message);

// Pages marked `todo` that are deliberately not owned by an epic, with the reason. Only a page whose
// `todo` marking is itself wrong belongs here — a real gap gets an epic.
const NOT_A_FEATURE_GAP = {
  upsert:
    'The page is stale, not blocked: `onConflict` (query-compiler/src/index.ts:167) and `upsert` ' +
    '(repository/src/index.ts:717) both exist. Tracked as a documentation issue, and flipping the page ' +
    'to supported moves the 190/86 counts quoted in the README.',
};

const todoPages = Object.entries(PAGE_META)
  .filter(([slug, meta]) => meta.status === 'todo' && !(slug in NOT_A_FEATURE_GAP))
  .map(([slug]) => slug);

// One page, one epic. A page claimed twice means two epics overlap, which breaks the promise that
// each epic is independent; a page claimed zero times means a gap ships unowned.
const claimedBy = new Map();
for (const epic of EPICS) {
  for (const page of epic.pages) {
    if (!(page in PAGE_META)) note(`epic ${epic.key}: page '${page}' is not in PAGE_META`);
    else if (PAGE_META[page].status !== 'todo') note(`epic ${epic.key}: page '${page}' is already supported`);
    const owners = claimedBy.get(page) ?? [];
    owners.push(epic.key);
    claimedBy.set(page, owners);
  }
}

for (const [page, owners] of claimedBy) {
  if (owners.length > 1) note(`page '${page}' is claimed by ${owners.length} epics: ${owners.join(', ')}`);
}
for (const page of todoPages) {
  if (!claimedBy.has(page)) note(`todo page '${page}' is not claimed by any epic`);
}

// Prose is where the wrong file path hides. `epic.pages` is checked above, but a sub-issue's `files` and
// `steps` name content files too, and a developer sent to `docs-site/content/<slug>.md` for a slug that was
// never in `PAGE_META` wastes their time on a file they have to invent.
const CONTENT_PATH = /docs-site\/content\/([a-z0-9-]+)\.md/g;
const strings = value =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

for (const epic of EPICS) {
  for (const text of strings(epic)) {
    for (const [, slug] of text.matchAll(CONTENT_PATH)) {
      if (!(slug in PAGE_META)) note(`epic ${epic.key}: names 'docs-site/content/${slug}.md', which is not a page`);
    }
  }
}

// Every sub-issue key is addressable as `epicKey:subKey`, and every blocker must resolve to one.
const subKeys = new Set();
const epicKeys = new Set();
for (const epic of EPICS) {
  if (epicKeys.has(epic.key)) note(`duplicate epic key '${epic.key}'`);
  epicKeys.add(epic.key);
  const seen = new Set();
  for (const sub of epic.subs) {
    if (seen.has(sub.key)) note(`epic ${epic.key}: duplicate sub key '${sub.key}'`);
    seen.add(sub.key);
    subKeys.add(`${epic.key}:${sub.key}`);
  }
}

for (const epic of EPICS) {
  for (const sub of epic.subs) {
    for (const ref of sub.blockedBy ?? []) {
      const key = ref.includes(':') ? ref : `${epic.key}:${ref}`;
      if (!subKeys.has(key)) note(`epic ${epic.key}, sub ${sub.key}: blockedBy '${ref}' does not resolve`);
    }
  }
}

// Titles are the idempotency key for the filing run, so a collision would make a resumed run edit the
// wrong issue.
const titles = new Map();
for (const epic of EPICS) {
  const add = (title, where) => {
    if (titles.has(title)) note(`duplicate title ${JSON.stringify(title)} (${titles.get(title)} and ${where})`);
    else titles.set(title, where);
  };
  add(epic.title, `epic ${epic.key}`);
  for (const sub of epic.subs) add(`[sub-issue] ${sub.title}`, `${epic.key}:${sub.key}`);
}

// Required fields, so a half-written epic cannot reach the API.
for (const epic of EPICS) {
  for (const field of ['title', 'labels', 'pages', 'packages', 'motivation', 'dod', 'invariants', 'subs']) {
    if (epic[field] === undefined) note(`epic ${epic.key}: missing '${field}'`);
  }
  for (const sub of epic.subs) {
    for (const field of ['title', 'labels', 'goal', 'dod']) {
      if (sub[field] === undefined) note(`epic ${epic.key}, sub ${sub.key}: missing '${field}'`);
    }
  }
  if (epic.subs[0]?.key !== 'spec') {
    note(`epic ${epic.key}: first sub-issue is '${epic.subs[0]?.key}', not the spec freeze`);
  }
  const last = epic.subs.at(-1);
  if (!last?.docs) note(`epic ${epic.key}: last sub-issue '${last?.key}' is not the docs slice`);
}

const subCount = EPICS.reduce((n, epic) => n + epic.subs.length, 0);
const labels = new Set(EPICS.flatMap(e => [...e.labels, ...e.subs.flatMap(s => s.labels)]));

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(`${EPICS.length} epics, ${subCount} sub-issues, ${claimedBy.size}/${todoPages.length} todo pages claimed.`);
for (const [slug, why] of Object.entries(NOT_A_FEATURE_GAP)) console.log(`excluded: ${slug} — ${why}`);
console.log(`labels used: ${[...labels].toSorted().join(', ')}`);
