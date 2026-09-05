// Compile-only contract for @zmdb/ai's root provider-document surface.

import type { CoreSchema, Equal, Expect } from '@zmdb/schema-core';
import type { JsonSchemaObject } from '@zmdb/schema-core/openapi';

import { toolFor, type ToolProvider, type ToolSpec, type ToolSpecFor } from './index.js';

type FrozenToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only surface`);
}

const frozenSchema = (): CoreSchema<string> => unimplemented('schema');

const anthropic = toolFor('anthropic', 'create_record', frozenSchema());
const openai = toolFor('openai', 'create_record', frozenSchema());
const strict = toolFor('openai-strict', 'create_record', frozenSchema());
const gemini = toolFor('gemini', 'create_record', frozenSchema());
const generic = toolFor('json-schema', 'create_record', frozenSchema());

interface DeclaredRecord {}

const aotAnthropic = toolFor<DeclaredRecord>('anthropic', 'create_record');
const aotStrict = toolFor<DeclaredRecord>('openai-strict', 'create_record');

type GeminiSchemaObject = ToolSpecFor['gemini']['parameters'];
type StrictJsonSchemaObject = ToolSpecFor['openai-strict']['function']['parameters'];

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
export type _gemini_has_provider_specific_parameters = Expect<Equal<typeof gemini.parameters, GeminiSchemaObject>>;
export type _json_schema_provider_preserves_tool_spec = Expect<Equal<typeof generic, ToolSpec>>;
export type _aot_provider_preserves_anthropic_return = Expect<
  Equal<typeof aotAnthropic.input_schema, JsonSchemaObject>
>;
export type _aot_strict_document_is_specific = Expect<
  Equal<typeof aotStrict.function.parameters, StrictJsonSchemaObject>
>;
