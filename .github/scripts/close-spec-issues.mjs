#!/usr/bin/env node
// Comment TDD-red evidence on each spec-freeze issue and close it.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
const SHA = '7403269';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 }).trim();
}

// issue -> { spec, tests: [file (count)], base }
const MAP = {
  11: { spec: 'packages/schema-core/SPEC.md', tests: 'packages/schema-core/src/schema-core.spec.ts (14)' },
  16: { spec: 'packages/query-compiler/SPEC.md', tests: 'packages/query-compiler/src/query-compiler.spec.ts (8)' },
  21: { spec: 'packages/aot-validator/SPEC.md', tests: 'packages/aot-validator/src/aot-validator.spec.ts (7)' },
  25: { spec: 'packages/repository/SPEC.md', tests: 'packages/repository/src/repository.spec.ts (5)' },
  30: { spec: 'packages/schema-core/src/relations/SPEC.md', tests: 'packages/schema-core/src/relations/relations.spec.ts (4)' },
  35: { spec: 'packages/repository/src/transactions/SPEC.md', tests: 'packages/repository/src/transactions/transactions.spec.ts (4)' },
  40: { spec: 'packages/query-compiler/src/migrations/SPEC.md', tests: 'packages/query-compiler/src/migrations/migrations.spec.ts (4)' },
  45: { spec: 'packages/aot-validator/src/advanced/SPEC.md', tests: 'packages/aot-validator/src/advanced/advanced.spec.ts (4)' },
  51: { spec: 'packages/aot-validator/src/serialization/SPEC.md', tests: 'packages/aot-validator/src/serialization/serialization.spec.ts (13)' },
  56: { spec: 'packages/aot-validator/src/utilities/SPEC.md', tests: 'packages/aot-validator/src/utilities/utilities.spec.ts (6)' },
};

const ROOT = 'packages'; // retained for reference; paths in MAP are already root-relative
void ROOT;
for (const [issue, m] of Object.entries(MAP)) {
  const body = [
    '## Spec Freeze complete ✅ (TDD red phase)',
    '',
    `Delivered in commit ${SHA}:`,
    '',
    `- **Frozen spec**: \`${m.spec}\``,
    `- **Failing tests**: \`${m.tests}\``,
    '',
    'The spec is frozen and the test suite is authored and **verified failing** ' +
      '(all assertions fail with `Error: not implemented`, i.e. compiles cleanly and ' +
      'fails on behavior — the correct TDD red state). Full run: **10 test files, 69 tests, all red.**',
    '',
    'Acceptance criteria for this spec-freeze issue are met:',
    '- [x] Committed `SPEC.md` enumerating the frozen contract.',
    '- [x] Test file compiles and all tests FAIL (no implementation yet).',
    '',
    'Implementation continues in the dependent (blocked) sub-issues, which are now unblocked to begin as each predecessor lands.',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], body);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`commented + closed #${issue}`);
}
console.log('DONE');
