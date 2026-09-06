import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'no-empty-patch';
const realistic = fixture('valid-near-misses.ts');

it('does not report the realistic fixture for non-empty updates', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it('does not report a patch supplied through a variable', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'repo.update(id, patch);\n' }],
    invalid: [],
  });
});

it('does not report a literal patch with one property', async () => {
  await runRuleCase(rule, {
    valid: [{ code: "repo.update(id, { email: 'reader@example.test' });\n" }],
    invalid: [],
  });
});

it('does not report a patch containing a spread', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'repo.update(id, { ...patch });\n' }],
    invalid: [],
  });
});

it('reports an empty literal patch at the object', async () => {
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code: 'await repo.update(id, {});\n',
        output: null,
        errors: [
          {
            message: 'update(id, {}) performs no write; it reads and returns the matching row.',
            line: 1,
            column: 23,
            endLine: 1,
            endColumn: 25,
          },
        ],
      },
    ],
  });
});
