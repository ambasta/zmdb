#!/usr/bin/env node
// Reconcile checkbox state on the 11 CLOSED implementation sub-issues.
// Unlike spec-freeze issues, ALL boxes on these are genuinely met (red-first,
// now green, deps clean, no arch violations), so we check every box.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
const ISSUES = [12, 17, 22, 26, 31, 36, 41, 46, 52, 57, 64];

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}

for (const n of ISSUES) {
  const body = gh(['issue', 'view', String(n), '--repo', REPO, '--json', 'body', '-q', '.body']);
  const out = body
    .split('\n')
    .map((line) => (line.startsWith('- [ ]') ? line.replace('- [ ]', '- [x]') : line))
    .join('\n');
  if (out === body) {
    console.log(`#${n}: already all-checked`);
    continue;
  }
  gh(['issue', 'edit', String(n), '--repo', REPO, '--body-file', '-'], out);
  console.log(`#${n}: all task boxes checked`);
}
console.log('DONE');
