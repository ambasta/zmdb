#!/usr/bin/env node
// Check all task boxes, comment red-phase evidence, close the 4 spec-freezes.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(a, i) {
  return execFileSync('gh', a, { encoding: 'utf8', input: i, maxBuffer: 16 * 1024 * 1024 }).trim();
}
const MAP = {
  79: {
    spec: 'packages/aot-validator/src/plugin/SPEC.md',
    tests: 'plugin/plugin.spec.ts (5)',
    note: 'Frozen AOT build-plugin contract: ts-patch/unplugin surface, intercepted is/assert/validate calls, monomorphic allocation-free emitted-JS (no TypeDescriptor walk), golden fixtures, and the benchmark acceptance target (AOT >=5x runtime, within 2x TypeBox-JIT).',
  },
  84: {
    spec: 'packages/query-compiler/src/joins/SPEC.md',
    tests: 'joins/joins.spec.ts (3)',
    note: 'Frozen JOIN grammar: inner/left/right + qualified on-columns + table aliasing (self-join) + dialect quoting, with golden postgres SQL.',
  },
  89: {
    spec: 'packages/query-compiler/src/aggregations/SPEC.md',
    tests: 'aggregations/aggregations.spec.ts (3)',
    note: 'Frozen aggregate grammar: count/sum/avg/min/max + expr() computed columns + groupBy + having + result typing, with golden SQL.',
  },
  94: {
    spec: 'packages/query-compiler/src/fts/SPEC.md',
    tests: 'fts/fts.spec.ts (3)',
    note: 'Frozen full-text-search grammar: whereMatch per dialect (pg to_tsvector/@@/to_tsquery; mysql MATCH...AGAINST; sqlite = honest DNF via UnsupportedFeatureError), parameterized.',
  },
};
for (const [issue, m] of Object.entries(MAP)) {
  const body = gh(['issue', 'view', issue, '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checked = body
    .split('\n')
    .map(l => (l.startsWith('- [ ]') ? l.replace('- [ ]', '- [x]') : l))
    .join('\n');
  if (checked !== body) gh(['issue', 'edit', issue, '--repo', REPO, '--body-file', '-'], checked);
  const comment = [
    '## Spec Freeze complete ✅ (TDD red phase)',
    '',
    `- **Frozen spec**: \`${m.spec}\``,
    `- **Failing tests**: \`${m.tests}\``,
    '',
    m.note,
    '',
    'Verified: spec committed; tests authored and **failing** (`Error: not implemented`), compiling cleanly; package typechecks clean. Full suite: 175 passing (all prior work intact) + 14 new red (the 4 spec-freeze suites, this being one). Implementation continues in the blocked sub-issues.',
    '',
    '_All task boxes checked._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: boxes checked, evidence posted, closed`);
}
console.log('DONE');
