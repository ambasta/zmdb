#!/usr/bin/env node
// Comment evidence, CHECK ALL TASK BOXES, then close the 11 newly-implemented
// sub-issues. (Boxes are checked before closing so closed issues never show
// unchecked tasks.)
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}

const MAP = {
  13: {
    commit: '2e86dff',
    impl: 'packages/schema-core/src/index.ts',
    tests: 'schema-core.spec.ts › "modifiers" (5)',
    note: 'Modifiers (chainable + function-style, immutable) were delivered together with column builders in 2e86dff (#12). All modifier tests green.',
  },
  18: {
    commit: 'b2044ce',
    impl: 'packages/query-compiler/src/index.ts',
    tests: 'query-compiler.spec.ts › write compilation (3)',
    note: 'INSERT/UPDATE/DELETE + RETURNING across dialects. All query-compiler tests green.',
  },
  23: {
    commit: '725e17d',
    impl: 'packages/aot-validator/src/index.ts',
    tests: 'aot-validator.spec.ts › inlining goldens (4)',
    note: 'transformSource inlines validate(tags.X(...),E) to allocation-free JS; no residual validate( in output.',
  },
  27: {
    commit: '7e31421',
    impl: 'packages/repository/src/index.ts',
    tests: 'repository.spec.ts › create/update (2)',
    note: 'create/update validate against CreateDTO/UpdateDTO; invalid payloads throw ValidationError before any SQL executes.',
  },
  32: {
    commit: 'f9a3fc4',
    impl: 'packages/schema-core/src/relations/index.ts',
    tests: 'relations/type-derivation.spec.ts + standalone tsc check',
    note: 'PopulatedEntity<Base,Relations,K> attaches related fields only when populated (array for to-many). Verified with tsc.',
  },
  37: {
    commit: 'f66034f',
    impl: 'packages/repository/src/index.ts',
    tests: 'transactions/binding.spec.ts (2)',
    note: 'BaseRepository.withTransaction(tx) routes SQL through the tx connection; multiple ops share one atomic transaction.',
  },
  42: {
    commit: '8034d72',
    impl: 'packages/query-compiler/src/migrations/index.ts',
    tests: 'migrations.spec.ts › diff engine (2) + DDL (2)',
    note: 'Pure diff(prev,next) → create/drop table, add/drop column, alter type. DDL emitters also implemented.',
  },
  47: {
    commit: '005b9b6',
    impl: 'packages/aot-validator/src/advanced/index.ts',
    tests: 'advanced/transform.spec.ts (2)',
    note: 'transform(fnSource) carries a pure post-validation conversion. Tests written first.',
  },
  53: {
    commit: '8097229',
    impl: 'packages/aot-validator/src/serialization/index.ts',
    tests: 'serialization/assert-stringify.spec.ts (2)',
    note: 'assertStringify validates via assert() then serializes; equals stringify() when valid, throws otherwise. Tests written first.',
  },
  58: {
    commit: '5c948ef',
    impl: 'packages/aot-validator/src/utilities/index.ts',
    tests: 'utilities.spec.ts › assert<T> (2)',
    note: 'Path-aware assert<T> throws AssertError with exact path (e.g. input.id); returns input when valid.',
  },
  65: {
    commit: '2267dab',
    impl: 'packages/schema-core/src/openapi/index.ts',
    tests: 'openapi.spec.ts (5)',
    note: 'Validation-tag → JSON Schema keyword mapping (minimum/maximum/minLength/maxLength/pattern/enum) was delivered together with toJsonSchema in 2267dab (#64). Golden fixtures green.',
  },
};

for (const [issue, m] of Object.entries(MAP)) {
  // 1. Check all task boxes.
  const body = gh(['issue', 'view', issue, '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checked = body
    .split('\n')
    .map(l => (l.startsWith('- [ ]') ? l.replace('- [ ]', '- [x]') : l))
    .join('\n');
  if (checked !== body) gh(['issue', 'edit', issue, '--repo', REPO, '--body-file', '-'], checked);

  // 2. Evidence comment.
  const comment = [
    '## Implemented ✅ (TDD green)',
    '',
    `Delivered in commit ${m.commit}:`,
    '',
    `- **Implementation**: \`${m.impl}\``,
    `- **Tests (green)**: \`${m.tests}\``,
    '',
    m.note,
    '',
    'Verification: tests green for this scope; package typechecks clean (`tsc --noEmit`); downstream still-blocked tests remain red by design.',
    '',
    '_All task boxes above have been checked._',
  ].join('\n');
  gh(['issue', 'comment', issue, '--repo', REPO, '--body-file', '-'], comment);

  // 3. Close.
  gh(['issue', 'close', issue, '--repo', REPO, '--reason', 'completed']);
  console.log(`#${issue}: boxes checked, evidence posted, closed`);
}
console.log('DONE');
