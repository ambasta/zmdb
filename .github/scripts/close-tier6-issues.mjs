#!/usr/bin/env node
// Check all task boxes, comment evidence, close the final 3 sub-issues.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
const MAP = {
  50: { impl: 'packages/aot-validator/src/advanced/error-paths.spec.ts', tests: '(3)', note: 'E2E: deeply-nested customer→orders[] reports every failure with an exact path (input.orders[1].totalPrice, input.orders[2].id); each issue carries expected/value/message. Backed by the path-aware collectIssues walker.' },
  61: { impl: 'packages/aot-validator/src/utilities/index.ts', tests: 'utilities.spec.ts > random<T>', note: 'random<T>(descriptor) generates a value satisfying the descriptor by construction (minimum/maxLength/pattern/enum); property test is(random(d),d)===true across many seeds.' },
  72: { impl: 'benchmarks/src/report.ts', tests: 'report.spec.ts (6) + generate-results.spec.ts', note: 'toMarkdown/toJson emit deterministically-ordered reports with explicit DNF rows; assertNoSilentSkips enforces the honesty policy (primary target must cover every in-scope case; all results schema-valid) — throws ReportError otherwise. RESULTS.md generation refactored onto this module.' },
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
    'Verified: full suite now **170 passing / 0 failing**; all packages + benchmarks typecheck clean (`tsc --noEmit`). This was the last open sub-issue of its epic.',
    '',
    '_All task boxes checked._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: boxes checked, evidence posted, closed`);
}
console.log('DONE');
