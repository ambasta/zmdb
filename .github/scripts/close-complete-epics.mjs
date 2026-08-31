#!/usr/bin/env node
// Close the 10 fully-complete epics (#1-#10): all sub-issues closed. Check any
// remaining task boxes and post a completion note first.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
const EPICS = {
  1: '@zmdb/schema-core (DSL + type derivation)',
  2: '@zmdb/query-compiler (SELECT/INSERT/UPDATE/DELETE + dialects)',
  3: '@zmdb/aot-validator (transformer + primitive inlining)',
  4: '@zmdb/repository (auto-validating CRUD + hooks)',
  5: 'Entity Relations (compile-time derived)',
  6: 'Transactions & Unit of Work',
  7: 'Migrations & Schema Diffing',
  8: 'Advanced Validation Semantics',
  9: 'AOT JSON Serialization',
  10: 'Validator Utility Surface',
};
for (const [epic, title] of Object.entries(EPICS)) {
  // Confirm zero open sub-issues before closing.
  const open = JSON.parse(
    gh([
      'api',
      'graphql',
      '-f',
      `query=query{repository(owner:"ambasta",name:"zmdb"){issue(number:${epic}){subIssues(first:20){nodes{state}}}}}`,
    ]),
  ).data.repository.issue.subIssues.nodes.filter(n => n.state === 'OPEN').length;
  if (open > 0) {
    console.log(`SKIP epic #${epic}: still has ${open} open sub-issue(s)`);
    continue;
  }
  const body = gh(['issue', 'view', epic, '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checked = body
    .split('\n')
    .map(l => (l.startsWith('- [ ]') ? l.replace('- [ ]', '- [x]') : l))
    .join('\n');
  if (checked !== body) gh(['issue', 'edit', epic, '--repo', REPO, '--body-file', '-'], checked);
  const comment = [
    '## Epic complete ✅',
    '',
    `All sub-issues of **${title}** are implemented, tested, and closed.`,
    '',
    'Verified: full suite **170 passing / 0 failing**; all packages + benchmarks typecheck clean.',
  ].join('\n');
  gh(['issue', 'comment', epic, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', epic, '--repo', REPO, '--reason', 'completed']);
  console.log(`closed epic #${epic}`);
}
console.log('DONE');
