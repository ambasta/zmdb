#!/usr/bin/env node
// Post green-phase evidence and close the 11 now-implemented sub-issues.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
const SHA = 'b994618';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 }).trim();
}

// issue -> { impl, tests, greenNote }
const MAP = {
  12: {
    impl: 'packages/schema-core/src/index.ts',
    tests: 'schema-core.spec.ts › "column builders" (5) + "modifiers" (5)',
    note: 'All 9 column-builder/modifier tests green; defineSchema tests remain red for #15.',
  },
  17: {
    impl: 'packages/query-compiler/src/index.ts',
    tests: 'query-compiler.spec.ts › "postgres SELECT compilation" (3) + SELECT-based dialect tests (2)',
    note: 'SELECT green; INSERT/UPDATE/DELETE remain red for #18.',
  },
  22: {
    impl: 'packages/aot-validator/src/index.ts',
    tests: 'aot-validator.spec.ts › identity transform + runtime-safety fallback (3)',
    note: 'Scaffold + runtime fallback green; primitive-tag inlining remains red for #23.',
  },
  26: {
    impl: 'packages/repository/src/index.ts',
    tests: 'repository.spec.ts › "read methods" (2)',
    note: 'findById/findOne/findAll green; create/update/delete remain red for #27/#28.',
  },
  31: {
    impl: 'packages/schema-core/src/relations/index.ts',
    tests: 'relations.spec.ts (4)',
    note: 'All relation-builder tests green.',
  },
  36: {
    impl: 'packages/repository/src/transactions/index.ts',
    tests: 'transactions.spec.ts (4)',
    note: 'BEGIN/COMMIT/ROLLBACK + savepoint ordering green.',
  },
  41: {
    impl: 'packages/query-compiler/src/migrations/index.ts',
    tests: 'migrations/snapshot.spec.ts (3, added TDD-first)',
    note: 'Deterministic snapshot serializer green; diff/DDL remain red for #42/#43.',
  },
  46: {
    impl: 'packages/aot-validator/src/advanced/index.ts',
    tests: 'advanced/advanced.spec.ts (4)',
    note: 'refine() + refinement-aware validateObject (exact paths) + coercion/strictness green.',
  },
  52: {
    impl: 'packages/aot-validator/src/serialization/index.ts',
    tests: 'serialization/serialization.spec.ts (13)',
    note: 'stringify (JSON-identical + bigint TypeError) and parse green; assertStringify remains for #53.',
  },
  57: {
    impl: 'packages/aot-validator/src/utilities/index.ts',
    tests: 'utilities/utilities.spec.ts › "is<T>" (1)',
    note: 'is<T> guard green; assert/validate/equals/random remain red for #58–#61.',
  },
  64: {
    impl: 'packages/schema-core/src/openapi/index.ts',
    tests: 'openapi/openapi.spec.ts (5)',
    note: 'toJsonSchema scalar/enum/nullable + tag mapping + variants + toOpenApiComponents green.',
  },
};

for (const [issue, m] of Object.entries(MAP)) {
  const body = [
    '## Implemented ✅ (TDD green)',
    '',
    `Delivered in commit ${SHA}:`,
    '',
    `- **Implementation**: \`${m.impl}\``,
    `- **Tests (green)**: \`${m.tests}\``,
    '',
    m.note,
    '',
    'Verification:',
    '- [x] Tests were red (from the spec-freeze), now green for this scope.',
    '- [x] Package typechecks clean (`tsc --noEmit`).',
    '- [x] Downstream (still-blocked) tests remain red by design.',
    '',
    '_Full suite at this commit: 54 passing / 23 red — every red test belongs to a still-blocked downstream sub-issue._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], body);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`commented + closed #${issue}`);
}
console.log('DONE');
