import type { TemplateFactory } from './types.js';

export const schemaTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.ts`,
      source: `import type { PrimaryKey, Serial, Sql, Table } from 'zmdb';

export interface ${name.pascal} extends Table<'${name.table}'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
}
`,
    },
    {
      path: `src/${name.fileStem}.spec.ts`,
      source: `import { Module, is, schemaOf } from 'zmdb';
import { createTestApp } from 'zmdb/testing';
import { describe, expect, it } from 'vitest';

import type { ${name.pascal} } from './${name.fileStem}.js';

@Module({})
class ${name.pascal}SchemaTestModule {}

describe('${name.pascal} schema', () => {
  it('emits the table declaration and validates through the transformer', async () => {
    const app = createTestApp(${name.pascal}SchemaTestModule);
    try {
      await app.init();
      expect(schemaOf<${name.pascal}>().table).toBe('${name.table}');
      expect(is<{ id: number }>({ id: 'x' })).toBe(false);
    } finally {
      await app[Symbol.asyncDispose]?.();
    }
  });
});
`,
    },
  ],
});
