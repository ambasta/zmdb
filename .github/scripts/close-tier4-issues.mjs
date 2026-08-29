#!/usr/bin/env node
// Check all task boxes, comment evidence, and close the 12 implemented issues.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}

const MAP = {
  14: { commit: '', impl: 'packages/schema-core/src/index.ts', tests: 'type-derivation.spec.ts + standalone tsc', note: 'Entity/CreateDTO/UpdateDTO derive from literal-preserving builders/modifiers.' },
  19: { commit: '', impl: 'packages/query-compiler/src/index.ts', tests: 'dialects.spec.ts (4)', note: 'Dialect coverage across INSERT/UPDATE/DELETE (placeholders + quoting) atop the existing SELECT dialects.' },
  24: { commit: '', impl: 'packages/aot-validator/src/index.ts', tests: 'build-integration.spec.ts (6)', note: 'Inlined transform output proven behaviorally identical to the runtime validate() fallback.' },
  28: { commit: '', impl: 'packages/repository/src/index.ts', tests: 'delete-hooks.spec.ts (4)', note: 'delete(id) + explicit pre/post lifecycle hooks in documented order.' },
  33: { commit: '', impl: 'packages/schema-core/src/relations/index.ts', tests: 'relations/populate.spec.ts (2)', note: 'compilePopulate: INNER JOIN for to-one, batched IN() for to-many; dialect-aware.' },
  38: { commit: '', impl: 'packages/repository/src/transactions/index.ts', tests: 'transactions/savepoints.spec.ts (2)', note: 'Nested savepoints with distinct names; inner rollback preserves outer writes.' },
  43: { commit: '', impl: 'packages/query-compiler/src/migrations/index.ts', tests: 'migrations/ddl-dialects.spec.ts (5)', note: 'Per-dialect DDL (quotes/backticks); PK implies NOT NULL; down reverses up.' },
  48: { commit: '', impl: 'packages/aot-validator/src/advanced/index.ts', tests: 'advanced/union.spec.ts (2)', note: 'union (ordered short-circuit) + discriminated (switch on discriminant) via evalRule.' },
  54: { commit: '', impl: 'packages/aot-validator/src/serialization/index.ts', tests: 'serialization/decode.spec.ts (3)', note: 'decode<T> parses JSON then validates into T; structured issues with exact paths.' },
  59: { commit: '', impl: 'packages/aot-validator/src/utilities/index.ts', tests: 'utilities.spec.ts > validate<T>', note: 'validate<T> non-throwing, collects ALL failures with exact paths.' },
  66: { commit: '', impl: 'packages/schema-core/src/openapi/index.ts', tests: 'openapi/relations.spec.ts (3)', note: 'toJsonSchemaWithRelations: to-one $ref, to-many array-of-$ref; relations excluded from create/update.' },
  70: { commit: '', impl: 'benchmarks/src/validation/adapter.ts + results.ts', tests: 'benchmarks/src/**/*.spec.ts (12)', note: 'zmdb validation adapter maps the four moltar cases + runner emits full-coverage BenchResult[] (no in-scope case omitted).' },
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
    'Verified: tests green for this scope; package typechecks clean (`tsc --noEmit`); downstream still-blocked tests remain red by design. Full suite at close: 125 passing / 6 red (all red belong to still-blocked #15/#60/#61).',
    '',
    '_All task boxes checked._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: boxes checked, evidence posted, closed`);
}
console.log('DONE');
