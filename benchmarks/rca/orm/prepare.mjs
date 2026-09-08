import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { schemaIrsFrom } from '@zmdb/compiler/testing';
import { diff, emitUp, snapshot } from '@zmdb/migrations';
import { postgres } from '@zmdb/postgres';
import { schemaFromIR } from '@zmdb/schema/ir';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('prepare requires --out <generated-schema.json>');
const schemas = schemaIrsFrom(
  fileURLToPath(new URL('./models.ts', import.meta.url)),
  ['RcaUser', 'RcaPost', 'RcaComment'],
  {
    project: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
  },
);
const operations = diff(
  { version: 1, tables: [], extensions: [] },
  snapshot(Object.values(schemas).map(schemaFromIR)),
  { dialect: postgres },
);
const ddl = operations.flatMap(operation => emitUp(operation, postgres));
await writeFile(values.out, `${JSON.stringify({ source: 'benchmarks/rca/orm/models.ts', schemas, ddl }, null, 2)}\n`);
console.log(JSON.stringify({ generated: values.out, models: Object.keys(schemas) }));
