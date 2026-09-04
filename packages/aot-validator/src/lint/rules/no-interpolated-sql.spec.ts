import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'no-interpolated-sql';
const realistic = fixture('valid-near-misses.ts');
const message = 'Do not interpolate values into SQL text; use driver parameters.';

it.fails('does not report the realistic fixture for SQL sinks', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it.fails('does not report a static template literal in text', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'const query = { text: `SELECT 1`, parameters: [] };\n' }],
    invalid: [],
  });
});

it.fails('does not report a parameterised where clause', async () => {
  await runRuleCase(rule, {
    valid: [{ code: "const query = { text: 'SELECT * FROM users WHERE id = $1', parameters: [id] };\n" }],
    invalid: [],
  });
});

it.fails('does not report a constant IndexDef expression', async () => {
  await runRuleCase(rule, {
    valid: [{ code: "const index = { name: 'users_email_ci', columns: [{ expr: 'lower(email)' }] };\n" }],
    invalid: [],
  });
});

it.fails('does not report interpolation outside a SQL sink', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'const greeting = `hello ${name}`;\n' }],
    invalid: [],
  });
});

it.fails('reports an interpolated text property at the template', async () => {
  const code = 'const id = 7;\nconst query = { text: `SELECT * FROM users WHERE id = ${id}`, parameters: [] };\n';
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output: null,
        errors: [{ message, line: 2, column: 23, endLine: 2, endColumn: 61 }],
      },
    ],
  });
});

it.fails('reports an interpolated direct execute argument at the template', async () => {
  const code = 'driver.execute(`DELETE FROM users WHERE id = ${id}`);\n';
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output: null,
        errors: [{ message, line: 1, column: 16, endLine: 1, endColumn: 52 }],
      },
    ],
  });
});
