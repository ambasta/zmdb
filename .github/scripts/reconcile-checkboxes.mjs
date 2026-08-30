#!/usr/bin/env node
// Robust pass 2: on CLOSED spec-freeze sub-issues, check EVERY remaining
// unchecked box EXCEPT the intentionally-deferred "green" DoD line.
// Rationale: for a spec-freeze, all acceptance criteria (SPEC committed, tests
// compile & fail) and the two applicable DoD lines (red achieved, no arch
// violations) are met; only "Implementation makes tests pass (green)" is
// legitimately outstanding and stays unchecked with its deferred annotation.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
const ISSUES = [11, 16, 21, 25, 30, 35, 40, 45, 51, 56, 63];

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}

for (const n of ISSUES) {
  const body = gh(['issue', 'view', String(n), '--repo', REPO, '--json', 'body', '-q', '.body']);
  const out = body
    .split('\n')
    .map(line => {
      if (!line.startsWith('- [ ]')) return line;
      // Preserve the deliberately-deferred green line as unchecked.
      if (line.includes('makes tests pass (green)')) return line;
      return line.replace('- [ ]', '- [x]');
    })
    .join('\n');
  if (out === body) {
    console.log(`#${n}: already consistent`);
    continue;
  }
  gh(['issue', 'edit', String(n), '--repo', REPO, '--body-file', '-'], out);
  console.log(`#${n}: remaining boxes checked`);
}
console.log('DONE');
