// Compile-only contract for @zmdb/ai's root provider-document surface.

import { type CoreSchema, type Equal, type Expect } from '@zmdb/schema';
import { type JsonSchemaObject } from '@zmdb/schema/openapi';
import { assert } from '@zmdb/validator';

import {
  lenientParse,
  type ParseResult,
  toolFor,
  type ToolProvider,
  type ToolSpec,
  type ToolSpecFor,
} from './index.js';

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

interface ParsedRecord {
  name: string;
}

const unvalidated = lenientParse('{"name":"record"}');
const parseThroughHelper = (text: string) => lenientParse(text);
export type _unvalidated_data_is_unknown = Expect<Equal<typeof unvalidated.data, unknown>>;
export type _helper_data_is_unknown = Expect<Equal<ReturnType<typeof parseThroughHelper>['data'], unknown>>;

// @ts-expect-error A type argument cannot establish the parsed output without a callback.
lenientParse<ParsedRecord>('{}');
// @ts-expect-error An absent callback cannot establish the parsed output.
lenientParse<ParsedRecord>('{}', undefined);
// @ts-expect-error Contextual assignment cannot establish the parsed output without a callback.
const claimed: ParseResult<ParsedRecord> = lenientParse('{}');
void claimed;

const validated = lenientParse<ParsedRecord>('{}', assert<ParsedRecord>);
const inferred = lenientParse('{}', assert<ParsedRecord>);
const decoded = lenientParse('"record"', value => {
  const input: Expect<Equal<typeof value, unknown>> = true;
  void input;
  if (typeof value !== 'string') throw new Error('Expected a string');
  return { name: value };
});
export type _explicit_callback_establishes_data = Expect<Equal<typeof validated.data, ParsedRecord | undefined>>;
export type _inferred_callback_establishes_data = Expect<Equal<typeof inferred.data, ParsedRecord | undefined>>;
export type _decoder_establishes_data = Expect<Equal<typeof decoded.data, ParsedRecord | undefined>>;
