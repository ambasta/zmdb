#!/usr/bin/env node
// Files the roadmap in ./epics/*.mjs onto GitHub: one epic per capability, sub-issues under it,
// native parent/child links and native blocked-by dependencies.
//
// Idempotent by title. A re-run creates nothing that already exists, adds only the links that are
// missing, and can therefore be used to resume after a rate limit, a network drop, or an edit to
// the data files. Nothing here deletes or closes an issue — undoing a mistake is a human decision.
//
// Usage:
//   node scripts/roadmap/file-issues.mjs --dry-run          # print what would be created
//   node scripts/roadmap/file-issues.mjs                    # create it
//   node scripts/roadmap/file-issues.mjs --refresh-bodies   # re-render bodies of issues that exist
//   ROADMAP_SLEEP=2000 node scripts/roadmap/file-issues.mjs
//
// The data files are the source of truth, so editing one after a filing run leaves the tracker stale.
// Epic bodies self-heal — the checklist pass at the end rewrites all of them every run — but a
// sub-issue body is written once at creation, which is what `--refresh-bodies` is for.
//
// GitHub's secondary rate limit is the constraint that shapes this script: content-creating
// requests are capped per minute and per hour, so every mutating call is spaced out and a 403 or
// 429 is treated as "wait and retry", not as a failure.

import { execFileSync } from 'node:child_process';

import { EPICS } from './epics/index.mjs';
import { renderChecklist, renderEpic, renderSub } from './render.mjs';

const REPO = process.env.ROADMAP_REPO ?? 'ambasta/zmdb';
const SLEEP = Number(process.env.ROADMAP_SLEEP ?? 1500);
const DRY = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh-bodies');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function gh(args, { input } = {}) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** A mutating API call: throttled, and patient with the secondary rate limit. */
async function api(path, body) {
  const args = ['api', `repos/${REPO}/${path}`, '--method', 'POST', '--input', '-'];
  for (let attempt = 1; ; attempt++) {
    try {
      const out = gh(args, { input: JSON.stringify(body) });
      await sleep(SLEEP);
      return out.trim() ? JSON.parse(out) : {};
    } catch (err) {
      const text = `${err.stderr ?? ''}${err.stdout ?? ''}`;
      const throttled = /rate limit|secondary|abuse|429|403/i.test(text);
      if (!throttled || attempt > 5) {
        throw new Error(`POST ${path} failed (attempt ${attempt}): ${text.slice(0, 800)}`, { cause: err });
      }
      const wait = 60_000 * attempt;
      console.warn(`  … rate limited on ${path}; waiting ${wait / 1000}s (attempt ${attempt})`);
      await sleep(wait);
    }
  }
}

/** Everything already on the tracker, so a re-run is a no-op instead of a duplicate. */
function existingIssues() {
  const raw = gh(['api', '--paginate', `repos/${REPO}/issues?state=all&per_page=100`]);
  const byTitle = new Map();
  for (const chunk of raw.split('\n').filter(Boolean)) {
    for (const issue of JSON.parse(chunk)) {
      if (issue.pull_request) continue;
      byTitle.set(issue.title, { number: issue.number, id: issue.id, body: issue.body ?? '' });
    }
  }
  return byTitle;
}

function subIssueNumbers(number) {
  try {
    const out = gh(['api', `repos/${REPO}/issues/${number}/sub_issues?per_page=100`]);
    return new Set(JSON.parse(out).map(i => i.number));
  } catch {
    return new Set();
  }
}

function blockedByNumbers(number) {
  try {
    const out = gh(['api', `repos/${REPO}/issues/${number}/dependencies/blocked_by?per_page=100`]);
    return new Set(JSON.parse(out).map(i => i.number));
  } catch {
    return new Set();
  }
}

/** GitHub hands bodies back with CRLF line endings; the renderer emits LF. Compare the text, not the newlines. */
const sameBody = (a, b) => a.replaceAll('\r\n', '\n').trim() === b.replaceAll('\r\n', '\n').trim();

async function ensureIssue(existing, title, body, labels, { refreshable = false } = {}) {
  const found = existing.get(title);
  if (found) {
    if (REFRESH && refreshable && !DRY && !sameBody(found.body ?? '', body)) {
      gh(['issue', 'edit', String(found.number), '--repo', REPO, '--body-file', '-'], { input: body });
      await sleep(SLEEP);
      console.log(`  ~ #${found.number} ${title}`);
    } else {
      console.log(`  = #${found.number} ${title}`);
    }
    return { ...found, created: false };
  }
  if (DRY) {
    console.log(`  + (dry) ${title}`);
    return { number: 0, id: 0, created: true };
  }
  const issue = await api('issues', { title, body, labels });
  existing.set(title, { number: issue.number, id: issue.id });
  console.log(`  + #${issue.number} ${title}`);
  return { number: issue.number, id: issue.id, created: true };
}

// --- resolve the plan ---------------------------------------------------------

/** `sub.blockedBy` entries are `'subKey'` (same epic) or `'epicKey:subKey'` (any epic). */
function resolveKey(ref, epicKey) {
  return ref.includes(':') ? ref : `${epicKey}:${ref}`;
}

const plan = [];
for (const epic of EPICS) {
  for (const sub of epic.subs) {
    plan.push({ epic, sub, key: `${epic.key}:${sub.key}` });
  }
}
const planned = new Set(plan.map(p => p.key));
for (const { epic, sub, key } of plan) {
  for (const ref of sub.blockedBy ?? []) {
    const resolved = resolveKey(ref, epic.key);
    if (!planned.has(resolved)) throw new Error(`${key} is blocked by "${resolved}", which is not in the plan`);
  }
}

const titles = new Set();
for (const epic of EPICS) {
  if (titles.has(epic.title)) throw new Error(`duplicate epic title: ${epic.title}`);
  titles.add(epic.title);
  for (const sub of epic.subs) {
    const t = `[sub-issue] ${sub.title}`;
    if (titles.has(t)) throw new Error(`duplicate sub-issue title: ${t}`);
    titles.add(t);
  }
}

console.log(`roadmap: ${EPICS.length} epics, ${plan.length} sub-issues, repo ${REPO}${DRY ? ' (dry run)' : ''}`);

// --- create -------------------------------------------------------------------

const existing = DRY ? new Map() : existingIssues();
const numbers = new Map(); // plan key -> issue number
const ids = new Map(); // plan key -> issue database id
const epicRefs = new Map();

for (const epic of EPICS) {
  console.log(`\n${epic.title}`);
  const created = await ensureIssue(existing, epic.title, renderEpic(epic), ['epic', ...(epic.labels ?? [])]);
  epicRefs.set(epic.key, created);

  for (const sub of epic.subs) {
    const title = `[sub-issue] ${sub.title}`;
    const body = renderSub(sub, epic, created.number);
    const labels = ['sub-issue', ...(sub.labels ?? []), ...(epic.labels ?? []).filter(l => l.startsWith('area:'))];
    if (sub.blockedBy?.length) labels.push('blocked');
    const ref = await ensureIssue(existing, title, body, [...new Set(labels)], { refreshable: true });
    numbers.set(`${epic.key}:${sub.key}`, ref.number);
    ids.set(`${epic.key}:${sub.key}`, ref.id);
  }
}

if (DRY) {
  console.log('\ndry run: no links written, no bodies edited');
  process.exit(0);
}

// --- link ---------------------------------------------------------------------

console.log('\nlinking sub-issues to their parents');
for (const epic of EPICS) {
  const parent = epicRefs.get(epic.key);
  const already = subIssueNumbers(parent.number);
  for (const sub of epic.subs) {
    const key = `${epic.key}:${sub.key}`;
    if (already.has(numbers.get(key))) continue;
    await api(`issues/${parent.number}/sub_issues`, { sub_issue_id: ids.get(key) });
    console.log(`  #${parent.number} ⊃ #${numbers.get(key)}`);
  }
}

console.log('\nrecording blocked-by dependencies');
for (const { epic, sub, key } of plan) {
  const refs = (sub.blockedBy ?? []).map(r => resolveKey(r, epic.key));
  if (refs.length === 0) continue;
  const already = blockedByNumbers(numbers.get(key));
  for (const ref of refs) {
    if (already.has(numbers.get(ref))) continue;
    await api(`issues/${numbers.get(key)}/dependencies/blocked_by`, { issue_id: ids.get(ref) });
    console.log(`  #${numbers.get(key)} ← #${numbers.get(ref)}`);
  }
}

console.log('\nwriting the sub-issue checklist into each epic');
for (const epic of EPICS) {
  const parent = epicRefs.get(epic.key);
  const children = epic.subs.map(sub => ({
    number: numbers.get(`${epic.key}:${sub.key}`),
    shortTitle: sub.title,
    blockedByNumbers: (sub.blockedBy ?? []).map(r => numbers.get(resolveKey(r, epic.key))),
  }));
  const body = renderEpic(epic).replace(
    '_Filled in by `scripts/roadmap/file-issues.mjs` once the children exist._',
    renderChecklist(children),
  );
  if (sameBody(parent.body ?? '', body)) {
    console.log(`  #${parent.number} checklist: already current`);
    continue;
  }
  gh(['issue', 'edit', String(parent.number), '--repo', REPO, '--body-file', '-'], { input: body });
  await sleep(SLEEP);
  console.log(`  #${parent.number} checklist: ${children.length} children`);
}

console.log('\ndone');
