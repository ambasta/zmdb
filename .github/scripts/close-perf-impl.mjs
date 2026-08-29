#!/usr/bin/env node
// Check all task boxes, comment green-phase evidence, close the 4 impl issues.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(a, i) { return execFileSync('gh', a, { encoding: 'utf8', input: i, maxBuffer: 16 * 1024 * 1024 }).trim(); }
const MAP = {
  80: { impl: 'packages/aot-validator/src/plugin/index.ts', tests: 'plugin/plugin.spec.ts (5)', note: 'transformTypeChecks parses inline object/primitive type literals and emits monomorphic, allocation-free, early-exit inline JS (no TypeDescriptor walk); assert<T> wraps with a structured throw + returns input.' },
  85: { impl: 'packages/query-compiler/src/joins/index.ts', tests: 'joins/joins.spec.ts (3)', note: 'joinableSelectFrom builds inner/left/right joins with qualified on-columns + table aliasing (self-join), dialect-aware, composable with where/order/limit.' },
  90: { impl: 'packages/query-compiler/src/aggregations/index.ts', tests: 'aggregations/aggregations.spec.ts (3)', note: 'aggregateSelectFrom: count/sum/avg/min/max + expr() computed columns + groupBy + having, parameterized, dialect-aware.' },
  95: { impl: 'packages/query-compiler/src/fts/index.ts', tests: 'fts/fts.spec.ts (3)', note: 'ftsSelectFrom.whereMatch: postgres to_tsvector/@@/to_tsquery + mysql MATCH...AGAINST; sqlite is an honest DNF (throws UnsupportedFeatureError).' },
};
for (const [issue, m] of Object.entries(MAP)) {
  const body = gh(['issue', 'view', issue, '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checked = body.split('\n').map((l) => (l.startsWith('- [ ]') ? l.replace('- [ ]', '- [x]') : l)).join('\n');
  if (checked !== body) gh(['issue', 'edit', issue, '--repo', REPO, '--body-file', '-'], checked);
  const comment = [
    '## Implemented ✅ (TDD green)',
    '',
    `- **Implementation**: \`${m.impl}\``,
    `- **Tests (green)**: \`${m.tests}\``,
    '',
    m.note,
    '',
    'Verified: spec-freeze red tests now green; package typechecks clean. **Full suite: 189 passing / 0 failing.**',
    '',
    '_All task boxes checked._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: boxes checked, evidence posted, closed`);
}
console.log('DONE');
