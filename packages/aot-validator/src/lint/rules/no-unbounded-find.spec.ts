import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'no-unbounded-find';
const realistic = fixture('valid-near-misses.ts');
const message = 'find() and find({}) are unbounded; use list() with a page.';

it.fails('does not report the realistic fixture for bounded reads', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it.fails('does not report find with a non-empty literal filter', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'repo.find({ id: 1 });\n' }],
    invalid: [],
  });
});

it.fails('does not report find with a variable filter', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'repo.find(filter);\n' }],
    invalid: [],
  });
});

it.fails('does not report Array.prototype.find with a callback', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'items.find(item => item.id === id);\n' }],
    invalid: [],
  });
});

it.fails('reports find with no argument at the call', async () => {
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code: 'repo.find();\n',
        output: null,
        errors: [{ message, line: 1, column: 1, endLine: 1, endColumn: 12 }],
      },
    ],
  });
});

it.fails('reports find with an empty literal filter at the call', async () => {
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code: 'repo.find({});\n',
        output: null,
        errors: [{ message, line: 1, column: 1, endLine: 1, endColumn: 14 }],
      },
    ],
  });
});
