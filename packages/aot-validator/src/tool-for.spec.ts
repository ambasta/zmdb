import { describe, expect, it } from 'vitest';

import { witnessSource } from './cli/witness.js';
import { FixtureProject } from './emit/__testing__/project.js';

const DECLARATIONS = `
  type Table<N extends string> = ZmdbTags.Table<N>;
  type Sql<N extends string> = ZmdbTags.Sql<N>;
  type Serial = ZmdbTags.Serial;
  type PrimaryKey = ZmdbTags.PrimaryKey;
  type HasDefault = ZmdbTags.HasDefault;

  type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

  function toolFor<T>(
    provider: ToolProvider,
    name: string,
    opts?: { readonly description?: string },
  ): unknown;

  interface ProviderFixture extends Table<'provider_fixtures'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    name: string & Sql<'text'>;
    nickname: string & Sql<'text'> & HasDefault;
    note: (string & Sql<'text'>) | null;
  }

  interface UntypedPayload extends Table<'untyped_payloads'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    payload: object & Sql<'json'>;
  }
`;

describe('toolFor AOT emission (#527)', () => {
  it('toolFor is inlined by the AOT transform', () => {
    using project = FixtureProject.open({ declarations: DECLARATIONS });
    const { check, code } = project.build(`
      const check = () => toolFor<ProviderFixture>(
        "openai-strict",
        "create_record",
        { description: "Create one record" },
      );
    `);

    expect(check(undefined)).toStrictEqual({
      type: 'function',
      function: {
        name: 'create_record',
        description: 'Create one record',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            nickname: { type: ['string', 'null'] },
            note: { type: ['string', 'null'] },
          },
          required: ['name', 'nickname', 'note'],
          additionalProperties: false,
        },
      },
    });
    expect(code).not.toContain('toolFor');
    expect(code).not.toContain('jsonSchemaFromShape');
    expect(code).not.toContain('"ir"');
    expect(code).toContain('additionalProperties');
  });

  it('reports provider refusals as locatable AOT diagnostics', () => {
    using project = FixtureProject.open({ declarations: DECLARATIONS });
    const result = project.transform(`
      const check = () => toolFor<UntypedPayload>("gemini", "store_payload");
    `);

    expect(result.changed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      fileName: project.module,
      callee: 'toolFor',
      path: 'payload',
    });
    expect(result.diagnostics[0]?.position).toBeTypeOf('number');
    expect(result.diagnostics[0]?.reason).toContain('gemini refuses untyped json');
    expect(result.diagnostics[0]?.reason).toContain('WireAs');
  });

  it('inlines a closed provider switch when the provider is selected at runtime', () => {
    using project = FixtureProject.open({ declarations: DECLARATIONS });
    const { check, code } = project.build(`
      const check = (provider) => toolFor<ProviderFixture>(provider, "create_record");
    `);

    expect(check('anthropic')).toMatchObject({
      name: 'create_record',
      input_schema: { type: 'object' },
    });
    expect(check('gemini')).toMatchObject({
      name: 'create_record',
      parameters: { type: 'object' },
    });
    expect(code).toContain('case "anthropic"');
    expect(code).toContain('case "gemini"');
    expect(code).not.toContain('toolFor');
  });

  it('keeps the provider and return type through the codegen witness', () => {
    const source = witnessSource({
      sourceName: 'tools.ts',
      entries: [{ callee: 'toolFor', typeText: 'ProviderFixture', name: 'zmdbToolProviderFixture' }],
      typeImports: [],
      calleeSources: new Map([['toolFor', '@zmdb/schema-core/llm']]),
      style: "'",
    });

    expect(source).toContain("import type { ToolOptions, ToolProvider, ToolSpecFor } from '@zmdb/schema-core/llm';");
    expect(source).toContain(
      'export function zmdbToolProviderFixture<P extends ToolProvider>' +
        '(provider: P, name: string, opts?: ToolOptions): ToolSpecFor[P] {',
    );
    expect(source).toContain('return toolFor<ProviderFixture, P>(provider, name, opts);');
  });
});
