import { it } from 'vitest';

import { fixture, runRuleCase } from '../__fixtures__/rule-tester.js';

const rule = 'no-distributed-nullable-tags';
const realistic = fixture('valid-near-misses.ts');
const nullableInput = fixture('nullable-tags.input.ts');
const nullableFixed = fixture('nullable-tags.fixed.ts');

it('does not report the realistic fixture for distributed nullable tags', async () => {
  await runRuleCase(rule, { valid: [{ code: realistic }], invalid: [] });
});

it('does not report a nullable tag written on the non-null arm', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { Table, Unique } from '@zmdb/schema-core/tags';\n" +
          "interface Account extends Table<'accounts'> { email: (string & Unique) | null; }\n",
      },
    ],
    invalid: [],
  });
});

it('does not report a nullable property outside a Table declaration', async () => {
  await runRuleCase(rule, {
    valid: [{ code: 'interface FormValue { email: (string | null) & Unique; }\n' }],
    invalid: [],
  });
});

it('does not report an arbitrary local intersection', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { Table } from '@zmdb/schema-core/tags';\n" +
          'type LocalMarker = { readonly local?: true };\n' +
          "interface Account extends Table<'accounts'> { email: (string | null) & LocalMarker; }\n",
      },
    ],
    invalid: [],
  });
});

it('does not treat a non-tag export from the tags module as an autofixable tag', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { NonNull, Table } from '@zmdb/schema-core/tags';\n" +
          "interface Account extends Table<'accounts'> { email: (string | null) & NonNull<string>; }\n",
      },
    ],
    invalid: [],
  });
});

it('does not report a union with no nullish arm', async () => {
  await runRuleCase(rule, {
    valid: [
      {
        code:
          "import type { Table, Unique } from '@zmdb/schema-core/tags';\n" +
          "interface Account extends Table<'accounts'> { externalId: (string | number) & Unique; }\n",
      },
    ],
    invalid: [],
  });
});

it('applies the autofix without changing behaviour', async () => {
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code: nullableInput,
        output: nullableFixed,
        errors: [
          {
            message: 'Move null and undefined outside the tagged intersection; nullish values cannot carry zmdb tags.',
            line: 4,
            column: 10,
            endLine: 4,
            endColumn: 34,
          },
        ],
      },
    ],
  });
});

it('reports a tag distributed across undefined', async () => {
  const code =
    "import type { Table, Unique } from '@zmdb/schema-core/tags';\n\n" +
    "interface Account extends Table<'accounts'> {\n" +
    '  alias: (string | undefined) & Unique;\n' +
    '}\n';
  const output =
    "import type { Table, Unique } from '@zmdb/schema-core/tags';\n\n" +
    "interface Account extends Table<'accounts'> {\n" +
    '  alias: (string & Unique) | undefined;\n' +
    '}\n';
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output,
        errors: [
          {
            message: 'Move null and undefined outside the tagged intersection; nullish values cannot carry zmdb tags.',
            line: 4,
            column: 10,
            endLine: 4,
            endColumn: 39,
          },
        ],
      },
    ],
  });
});

it('moves null outside an extension-backed column tag', async () => {
  const code =
    "import type { Ext, Table } from '@zmdb/schema-core/tags';\n\n" +
    "interface Document extends Table<'documents'> {\n" +
    "  embedding: (readonly number[] | null) & Ext<'vector', 'vector', [3]>;\n" +
    '}\n';
  const output =
    "import type { Ext, Table } from '@zmdb/schema-core/tags';\n\n" +
    "interface Document extends Table<'documents'> {\n" +
    "  embedding: (readonly number[] & Ext<'vector', 'vector', [3]>) | null;\n" +
    '}\n';
  await runRuleCase(rule, {
    valid: [],
    invalid: [
      {
        code,
        output,
        errors: [
          {
            message: 'Move null and undefined outside the tagged intersection; nullish values cannot carry zmdb tags.',
            line: 4,
            column: 14,
            endLine: 4,
            endColumn: 71,
          },
        ],
      },
    ],
  });
});
