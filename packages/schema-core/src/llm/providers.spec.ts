import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, expect, it } from 'vitest';

import type { CoreSchema } from '../index.js';
import { schemaFromIR, type ColumnIR } from '../ir/index.js';
import type { JsonSchemaObject } from '../openapi/index.js';
import type { Codec, HasDefault, PrimaryKey, Sensitive, Serial, Sql, Table, WireAs } from '../tags/index.js';
import { toolFromSchema } from './index.js';

const llmApi: object = await import('./index.js');

// Tests freeze for llm/SPEC.md (#526, epic #524).
//
// RED ON PURPOSE. `toolFor` is not exported at the tests-freeze baseline. A
// static import would stop collection, so `callToolFor` is the one documented boundary to the
// frozen surface. Every test that reaches it is `it.fails`; the two green
// controls call today's `toolFromSchema` and pin the exact input document the
// provider dialects must transform.
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

type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

interface StrictJsonSchemaObject extends JsonSchemaObject {
  readonly additionalProperties: false;
}

interface GeminiSchemaObject extends JsonSchemaObject {}

interface ToolSpecFor {
  readonly openai: {
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly parameters: JsonSchemaObject;
    };
  };
  readonly 'openai-strict': {
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly strict: true;
      readonly parameters: StrictJsonSchemaObject;
    };
  };
  readonly anthropic: {
    readonly name: string;
    readonly description?: string;
    readonly input_schema: JsonSchemaObject;
  };
  readonly gemini: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: GeminiSchemaObject;
  };
  readonly 'json-schema': {
    readonly name: string;
    readonly description?: string;
    readonly parameters: JsonSchemaObject;
  };
}

function callToolFor<P extends ToolProvider>(
  provider: P,
  name: string,
  schema: CoreSchema<string>,
  opts?: { readonly description?: string },
): ToolSpecFor[P] {
  const candidate: unknown = Reflect.get(llmApi, 'toolFor');
  if (typeof candidate !== 'function') {
    throw new Error('#526 tests freeze: toolFor is not exported from @zmdb/schema-core/llm');
  }
  const args = opts === undefined ? [provider, name, schema] : [provider, name, schema, opts];
  return Reflect.apply(candidate, undefined, args) as ToolSpecFor[P];
}

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

  it.fails('emits an OpenAI strict schema with additionalProperties false at every level', () => {
    const tool = callToolFor('openai-strict', 'create_record', ProviderSchema, {
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

  it.fails('lists every property in required and expresses an optional field as nullable under openai-strict', () => {
    const tool = callToolFor('openai-strict', 'create_record', ProviderSchema);
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

  it.fails('emits an OpenAI function schema without strict rewriting', () => {
    expect(callToolFor('openai', 'create_record', ProviderSchema)).toStrictEqual({
      type: 'function',
      function: {
        name: 'create_record',
        parameters: GENERIC_DOCUMENT,
      },
    });
  });

  it.fails('emits input_schema for anthropic', () => {
    expect(callToolFor('anthropic', 'create_record', ProviderSchema)).toStrictEqual({
      name: 'create_record',
      input_schema: GENERIC_DOCUMENT,
    });
  });

  it.fails('emits the Gemini subset and omits no required information', () => {
    expect(callToolFor('gemini', 'create_record', ProviderSchema)).toStrictEqual({
      name: 'create_record',
      parameters: GEMINI_DOCUMENT,
    });
  });

  it.fails('keeps the json-schema provider byte-identical to toolFromSchema', () => {
    const legacy = toolFromSchema('create_record', ProviderSchema, { description: 'Create one record' });
    const provider = callToolFor('json-schema', 'create_record', ProviderSchema, {
      description: 'Create one record',
    });
    expect(JSON.stringify(provider)).toBe(JSON.stringify(legacy));
  });

  it.fails('refuses an untyped json column for gemini, naming the provider and the path', () => {
    try {
      callToolFor('gemini', 'store_payload', UntypedPayloadSchema);
      expect.unreachable('gemini accepted an untyped json column');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('gemini');
      expect(Reflect.get(refusal, 'path')).toContain('payload');
      expect(Reflect.get(refusal, 'construct')).toBe('untyped json');
      expect(Reflect.get(refusal, 'suggestion')).toContain('WireAs');
    }
  });

  it.fails('refuses an untyped json column for openai-strict, naming the provider and the path', () => {
    try {
      callToolFor('openai-strict', 'store_payload', UntypedPayloadSchema);
      expect.unreachable('openai-strict accepted an untyped json column');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('openai-strict');
      expect(Reflect.get(refusal, 'path')).toContain('payload');
      expect(Reflect.get(refusal, 'construct')).toBe('untyped json');
      expect(Reflect.get(refusal, 'suggestion')).toContain('WireAs');
    }
  });

  it.fails('refuses a create schema with no visible properties', () => {
    try {
      callToolFor('anthropic', 'empty_tool', NoVisibleCreateSchema);
      expect.unreachable('a property-less create schema was accepted');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('anthropic');
      expect(Reflect.get(refusal, 'path')).toBeTypeOf('string');
      expect(Reflect.get(refusal, 'reason')).toContain('visible');
      expect(Reflect.get(refusal, 'suggestion')).toContain('Sensitive');
    }
  });

  it.fails('refuses a schema exceeding the provider property limit', () => {
    try {
      callToolFor('openai-strict', 'too_wide', OverPropertyLimitSchema);
      expect.unreachable('a schema beyond the provider limit was accepted');
    } catch (error) {
      const refusal = refusalOf(error);
      expect(Reflect.get(refusal, 'provider')).toBe('openai-strict');
      expect(Reflect.get(refusal, 'construct')).toContain('property limit');
      expect(Reflect.get(refusal, 'path')).toBeTypeOf('string');
    }
  });
});
