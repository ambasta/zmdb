import { DynamicStructuredTool } from '@langchain/core/tools';
import type { ToolSchema } from '@zmdb/ai';
import type { Equal, Expect } from '@zmdb/schema-core';

import { langchainTool, type LangChainToolFields, type ToolAdapterOptions } from './index.js';

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only surface`);
}

const schema = (): ToolSchema => unimplemented('schema');
const fields = langchainTool('echo', schema(), {
  description: 'Echo a value',
  validate: value => String(value),
  execute: value => ({ value }),
});
const tool = new DynamicStructuredTool(fields);

export type _FieldsMatchFrozenSurface = Expect<Equal<typeof fields, LangChainToolFields>>;
export type _FunctionReturnsText = Expect<Equal<Awaited<ReturnType<typeof fields.func>>, string>>;
export type _OptionsRemainProviderNeutral = ToolAdapterOptions<string, { readonly value: string }>;

void tool;
