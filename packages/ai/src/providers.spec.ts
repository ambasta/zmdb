import { schemasFrom } from '@zmdb/aot-validator/testing';
import { schemaFromIR, type ColumnIR } from '@zmdb/schema-core/ir';
import type { JsonSchemaObject } from '@zmdb/schema-core/openapi';
import type { Codec, HasDefault, PrimaryKey, Sensitive, Serial, Sql, Table, WireAs } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { toolFor, toolFromSchema, type ToolSpecFor } from './index.js';

// Implementation suite for llm/SPEC.md (#527, epic #524).
//
// The issue's original recursive/discriminated-union cases are deliberately
// absent. SPEC §1 establishes that schema-derived tools contain one object
// level with scalar leaves: literal unions are `enum`, and recursion cannot
// enter this API. The reachable refusals are an untyped `{}` column, an empty
// visible create shape, and a provider's published property limit.

interface Money {
  readonly cents: number;
}

type MoneyColumn = Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>;
type GeminiSchemaObject = ToolSpecFor['gemini']['parameters'];
type StrictJsonSchemaObject = ToolSpecFor['openai-strict']['function']['parameters'];

export interface ProviderFixture extends Table<'provider_fixtures'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  amount: MoneyColumn;
  createdAt: Date & Sql<'timestamp'>;
  count: bigint & Sql<'bigint'>;
  name: string & Sql<'text'>;
  nickname: string & Sql<'text'> & HasDefault;
  note: (string & Sql<'text'>) | null;
  state: 'active' | 'disabled';
}

export interface UntypedPayload extends Table<'untyped_payloads'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  payload: object & Sql<'json'>;
}

export interface NoVisibleCreateShape extends Table<'no_visible_create_shapes'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  secret: string & Sql<'text'> & Sensitive;
}

const {
  NoVisibleCreateShape: NoVisibleCreateSchema,
  ProviderFixture: ProviderSchema,
  UntypedPayload: UntypedPayloadSchema,
} = schemasFrom(import.meta.url, ['ProviderFixture', 'UntypedPayload', 'NoVisibleCreateShape']);

const GENERIC_DOCUMENT: JsonSchemaObject = {
  type: 'object',
  properties: {
    amount: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    count: { type: 'integer', format: 'int64' },
    name: { type: 'string' },
    nickname: { type: 'string' },
    note: { type: ['string', 'null'] },
    state: { type: 'string', enum: ['active', 'disabled'] },
  },
  required: ['amount', 'count', 'createdAt', 'name', 'state'],
};

const STRICT_DOCUMENT: StrictJsonSchemaObject = {
  type: 'object',
  properties: {
    amount: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    count: { type: 'integer' },
    name: { type: 'string' },
    nickname: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    state: { type: 'string', enum: ['active', 'disabled'] },
  },
  required: ['amount', 'count', 'createdAt', 'name', 'nickname', 'note', 'state'],
  additionalProperties: false,
};

const GEMINI_DOCUMENT: GeminiSchemaObject = {
  type: 'object',
  properties: {
    amount: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    count: { type: 'integer', format: 'int64' },
    name: { type: 'string' },
    nickname: { type: 'string' },
    note: { type: 'string', nullable: true },
    state: { type: 'string', enum: ['active', 'disabled'] },
  },
  required: ['amount', 'count', 'createdAt', 'name', 'state'],
};

const refusalOf = (error: unknown): object => {
  const refusal: unknown = Reflect.get(Object(error), 'refusal');
  expect(refusal).toBeTypeOf('object');
  return Object(refusal);
};

const textColumn = (name: string): ColumnIR => ({
  name,
  physicalName: name,
  sql: 'text',
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
});

const OverPropertyLimitSchema = schemaFromIR({
  table: 'over_property_limit',
  physicalTable: 'over_property_limit',
  columns: Array.from({ length: 1_025 }, (_, index) => textColumn(`field_${String(index).padStart(4, '0')}`)),
  primaryKey: [],
  relations: [],
  foreignKeys: [],
});

describe('provider-accepted LLM tool documents (#526)', () => {
  it('pins the shared one-level scalar fixture before any provider translation', () => {
    expect(toolFromSchema('create_record', ProviderSchema).parameters).toStrictEqual(GENERIC_DOCUMENT);
  });

  it('represents a declared literal union as enum rather than oneOf', () => {
    const property = Reflect.get(GENERIC_DOCUMENT.properties, 'state');
    expect(property).toStrictEqual({ type: 'string', enum: ['active', 'disabled'] });
    expect(JSON.stringify(GENERIC_DOCUMENT)).not.toContain('oneOf');
  });

  it('emits an OpenAI strict schema with additionalProperties false at every level', () => {
    const tool = toolFor('openai-strict', 'create_record', ProviderSchema, {
      description: 'Create one record',
    });
    expect(tool).toStrictEqual({
      type: 'function',
      function: {
        name: 'create_record',
        description: 'Create one record',
        strict: true,
        parameters: STRICT_DOCUMENT,
      },
    });
  });

  it('lists every property in required and expresses an optional field as nullable under openai-strict', () => {
    const tool = toolFor('openai-strict', 'create_record', ProviderSchema);
    expect(tool.function.parameters.required).toStrictEqual([
      'amount',
      'count',
      'createdAt',
      'name',
      'nickname',
      'note',
      'state',
    ]);
    expect(Reflect.get(tool.function.parameters.properties, 'nickname')).toStrictEqual({
      type: ['string', 'null'],
    });
  });

  it('emits an OpenAI function schema without strict rewriting', () => {
    expect(toolFor('openai', 'create_record', ProviderSchema)).toStrictEqual({
      type: 'function',
      function: {
        name: 'create_record',
        parameters: GENERIC_DOCUMENT,
      },
    });
  });

  it('emits input_schema for anthropic', () => {
    expect(toolFor('anthropic', 'create_record', ProviderSchema)).toStrictEqual({
      name: 'create_record',
      input_schema: GENERIC_DOCUMENT,
    });
  });

  it('emits the Gemini subset and omits no required information', () => {
    expect(toolFor('gemini', 'create_record', ProviderSchema)).toStrictEqual({
      name: 'create_record',
      parameters: GEMINI_DOCUMENT,
    });
  });

  it('keeps the json-schema provider byte-identical to toolFromSchema', () => {
    const legacy = toolFromSchema('create_record', ProviderSchema, { description: 'Create one record' });
    const provider = toolFor('json-schema', 'create_record', ProviderSchema, {
      description: 'Create one record',
    });
    expect(JSON.stringify(provider)).toBe(JSON.stringify(legacy));
  });

  it('keeps toolFromSchema behaviour for an empty visible create shape', () => {
    const legacy = toolFromSchema('empty_tool', NoVisibleCreateSchema);
    expect(legacy.parameters).toStrictEqual({ type: 'object', properties: {}, required: [] });
    expect(toolFor('json-schema', 'empty_tool', NoVisibleCreateSchema)).toStrictEqual(legacy);
  });

  it('refuses an untyped json column for gemini, naming the provider and the path', () => {
    try {
      toolFor('gemini', 'store_payload', UntypedPayloadSchema);
      expect.unreachable('gemini accepted an untyped json column');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('gemini');
      expect(Reflect.get(refusal, 'path')).toContain('payload');
      expect(Reflect.get(refusal, 'construct')).toBe('untyped json');
      expect(Reflect.get(refusal, 'suggestion')).toContain('WireAs');
    }
  });

  it('refuses an untyped json column for openai-strict, naming the provider and the path', () => {
    try {
      toolFor('openai-strict', 'store_payload', UntypedPayloadSchema);
      expect.unreachable('openai-strict accepted an untyped json column');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('openai-strict');
      expect(Reflect.get(refusal, 'path')).toContain('payload');
      expect(Reflect.get(refusal, 'construct')).toBe('untyped json');
      expect(Reflect.get(refusal, 'suggestion')).toContain('WireAs');
    }
  });

  it('refuses a create schema with no visible properties', () => {
    try {
      toolFor('anthropic', 'empty_tool', NoVisibleCreateSchema);
      expect.unreachable('a property-less create schema was accepted');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('anthropic');
      expect(Reflect.get(refusal, 'path')).toBeTypeOf('string');
      expect(Reflect.get(refusal, 'reason')).toContain('visible');
      expect(Reflect.get(refusal, 'suggestion')).toContain('Sensitive');
    }
  });

  it('refuses a schema exceeding the provider property limit', () => {
    try {
      toolFor('openai-strict', 'too_wide', OverPropertyLimitSchema);
      expect.unreachable('a schema beyond the provider limit was accepted');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('openai-strict');
      expect(Reflect.get(refusal, 'construct')).toContain('property limit');
      expect(Reflect.get(refusal, 'path')).toBeTypeOf('string');
    }
  });
});
