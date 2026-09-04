import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'no-unknown-json-column';
const realistic = fixture('valid-near-misses.ts');
const unknownInput = fixture('unknown-json.input.ts');
const unknownSuggested = fixture('unknown-json.suggested.ts');
const message = "unknown & X collapses to X; use object & Sql<'json'> or declare the JSON shape.";

it('does not report the realistic fixture for JSON column shapes', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it('does not report object as an unshaped JSON payload', async () => {
  await runRuleCase(rule, {
    valid: [{ code: "type Payload = object & Sql<'json'>;\n" }],
    invalid: [],
  });
});

it('does not report a declared JSON object shape', async () => {
  await runRuleCase(rule, {
    valid: [{ code: "type Payload = Record<string, boolean> & Sql<'json'>;\n" }],
    invalid: [],
  });
});

it('does not report standalone unknown', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'let payload: unknown;\nvoid payload;\n' }],
    invalid: [],
  });
});

it('reports unknown collapsed into a JSON tag', async () => {
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code: unknownInput,
        output: null,
        errors: [
          {
            message,
            line: 4,
            column: 16,
            endLine: 4,
            endColumn: 23,
            suggestions: [{ desc: 'Replace unknown with object', output: unknownSuggested }],
          },
        ],
      },
    ],
  });
});

it('reports unknown in either intersection order', async () => {
  const code = "type Payload = Sql<'json'> & unknown;\n";
  const output = "type Payload = Sql<'json'> & object;\n";
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output: null,
        errors: [
          {
            message,
            line: 1,
            column: 30,
            endLine: 1,
            endColumn: 37,
            suggestions: [{ desc: 'Replace unknown with object', output }],
          },
        ],
      },
    ],
  });
});
