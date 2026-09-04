// Compile-only freeze for llm/SPEC.md §5 and issue #526.
//
// `toolFor` is not exported in this tests-freeze slice. Its exact signature is
// therefore frozen locally, without a suppressed missing-export error; #527
// replaces the local surface with the public import.

import type { CoreSchema, Equal, Expect } from '../index.js';
import type { JsonSchemaObject } from '../openapi/index.js';
import type { ToolProvider, ToolSpec } from './index.js';

type FrozenToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

interface FrozenStrictJsonSchemaObject extends JsonSchemaObject {
  readonly additionalProperties: false;
}

interface FrozenGeminiSchemaObject extends JsonSchemaObject {}

interface FrozenToolSpecFor {
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
      readonly parameters: FrozenStrictJsonSchemaObject;
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
    readonly parameters: FrozenGeminiSchemaObject;
  };
  readonly 'json-schema': ToolSpec;
}

type FrozenToolFor = <P extends FrozenToolProvider>(
  provider: P,
  name: string,
  schema: CoreSchema<string>,
  opts?: { readonly description?: string },
) => FrozenToolSpecFor[P];

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only frozen surface`);
}

const frozenToolFor: FrozenToolFor = () => unimplemented('toolFor');
const frozenSchema = (): CoreSchema<string> => unimplemented('schema');

const anthropic = frozenToolFor('anthropic', 'create_record', frozenSchema());
const openai = frozenToolFor('openai', 'create_record', frozenSchema());
const strict = frozenToolFor('openai-strict', 'create_record', frozenSchema());
const gemini = frozenToolFor('gemini', 'create_record', frozenSchema());
const generic = frozenToolFor('json-schema', 'create_record', frozenSchema());

export type _provider_union_matches_frozen_surface = Expect<Equal<ToolProvider, FrozenToolProvider>>;
export type _anthropic_has_input_schema = Expect<Equal<typeof anthropic.input_schema, JsonSchemaObject>>;
export type _anthropic_has_no_function_key = Expect<
  Equal<'function' extends keyof typeof anthropic ? true : false, false>
>;
export type _openai_has_function_parameters = Expect<Equal<typeof openai.function.parameters, JsonSchemaObject>>;
export type _strict_flag_is_literal_true = Expect<Equal<typeof strict.function.strict, true>>;
export type _strict_document_requires_additional_properties_false = Expect<
  Equal<typeof strict.function.parameters.additionalProperties, false>
>;
export type _gemini_has_provider_specific_parameters = Expect<
  Equal<typeof gemini.parameters, FrozenGeminiSchemaObject>
>;
export type _json_schema_provider_preserves_tool_spec = Expect<Equal<typeof generic, ToolSpec>>;
