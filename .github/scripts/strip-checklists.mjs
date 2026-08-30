#!/usr/bin/env node
// Remove the now-redundant cosmetic "Sub-issues" markdown checklist from epic
// bodies, since native sub-issue relationships now render that panel on GitHub.
// Node 26+, ESM.
import { execFileSync } from 'node:child_process';
const OWNER = 'ambasta',
  REPO = 'zmdb';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
const MARKER = '## Sub-issues (complete in order';
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const body = gh(['issue', 'view', String(n), '--repo', `${OWNER}/${REPO}`, '--json', 'body', '-q', '.body']);
  const idx = body.indexOf(MARKER);
  if (idx === -1) {
    console.log(`#${n}: no checklist, skip`);
    continue;
  }
  // Trim the checklist plus the preceding "---" separator and surrounding whitespace.
  let cut =
    body
      .slice(0, idx)
      .replace(/\n+---\s*$/, '')
      .trimEnd() + '\n';
  gh(['issue', 'edit', String(n), '--repo', `${OWNER}/${REPO}`, '--body-file', '-'], cut);
  console.log(`#${n}: removed cosmetic checklist`);
}
console.log('DONE');
