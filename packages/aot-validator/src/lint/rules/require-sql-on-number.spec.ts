import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'require-sql-on-number';
const realistic = fixture('valid-near-misses.ts');

it.fails('does not report the realistic fixture for numeric SQL tags', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it.fails('does not report a number with an integer SQL tag', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { Sql, Table } from '@zmdb/schema-core/tags';\n" +
          "interface Score extends Table<'scores'> { value: number & Sql<'integer'>; }\n",
      },
    ],
    invalid: [],
  });
});

it.fails('does not report a tagged number hidden behind a type alias', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { Sql, Table } from '@zmdb/schema-core/tags';\n" +
          "type Money = number & Sql<'numeric'>;\n" +
          "interface Invoice extends Table<'invoices'> { total: Money; }\n",
      },
    ],
    invalid: [],
  });
});

it.fails('does not report a bare number outside a Table declaration', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'interface Point { x: number; y: number; }\n' }],
    invalid: [],
  });
});

it.fails('reports a bare number on a Table property', async () => {
  const code =
    "import type { Table } from '@zmdb/schema-core/tags';\n\n" +
    "interface Score extends Table<'scores'> {\n" +
    '  value: number;\n' +
    '}\n';
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output: null,
        errors: [
          {
            message: "A bare number is ambiguous; add Sql<'integer'> or Sql<'numeric'>.",
            line: 4,
            column: 10,
            endLine: 4,
            endColumn: 16,
          },
        ],
      },
    ],
  });
});
