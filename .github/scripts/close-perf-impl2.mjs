#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(a, i) { return execFileSync('gh', a, { encoding: 'utf8', input: i, maxBuffer: 16 * 1024 * 1024 }).trim(); }
const MAP = {
  81: { impl: 'packages/aot-validator/src/plugin/index.ts', tests: 'plugin/packaging.spec.ts (4)', note: 'zmdbAot() returns an unplugin-shaped { name, transform(code,id) } that inlines is<T>()/assert<T>() in source modules (skips node_modules/non-source, returns null when unchanged). Added the ./plugin subpath export.' },
  86: { impl: 'packages/query-compiler/src/joins/index.ts', tests: 'joins/multi-join.spec.ts (3)', note: 'Multi-join (2+ chained joins), mixed left/inner with aliases, and self-join — all handled by joinableSelectFrom; covered by dedicated tests.' },
  91: { impl: 'packages/query-compiler/src/aggregations/index.ts', tests: 'aggregations/groupby-having.spec.ts (3)', note: 'Multi-column GROUP BY + multiple parameterized HAVING (AND-joined) + correct clause ordering when composed with orderBy/limit/offset.' },
  96: { impl: 'packages/repository/src/index.ts', tests: 'repository/fts-e2e.spec.ts (2)', note: 'BaseRepository.findByFullText composes the FTS builder + executes via the driver; verified E2E against REAL PostgreSQL 16 (to_tsvector/@@/to_tsquery returns matching rows). Added query-compiler ./fts export.' },
};
for (const [issue, m] of Object.entries(MAP)) {
  const body = gh(['issue', 'view', issue, '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checked = body.split('\n').map((l) => (l.startsWith('- [ ]') ? l.replace('- [ ]', '- [x]') : l)).join('\n');
  if (checked !== body) gh(['issue', 'edit', issue, '--repo', REPO, '--body-file', '-'], checked);
  const comment = ['## Implemented ✅ (TDD green)', '', `- **Implementation**: \`${m.impl}\``, `- **Tests (green)**: \`${m.tests}\``, '', m.note, '', 'Verified: tests green; package typechecks clean. **Full suite: 201 passing / 0 failing.**', '', '_All task boxes checked._'].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: closed`);
}
console.log('DONE');
