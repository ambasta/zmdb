import { DynamicStructuredTool } from '@langchain/core/tools';
import type { CoreSchema } from '@zmdb/schema-core';
import type { JsonSchemaObject } from '@zmdb/schema-core/openapi';
import { jsonSchema, tool } from 'ai';

// Compile-only freeze for llm/adapters/SPEC.md §1 and §7.
//
// The public exports do not exist at the tests-freeze baseline, so this fixture
// transcribes the accepted signatures and checks their return values against the real framework
// constructors. #528 replaces these throwing values with imports from
// @zmdb/schema-core/llm. Nothing in this file is executed.

interface ToolAdapterOptions<T> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => unknown | PromiseLike<unknown>;
}

interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchemaObject;
  readonly func: (input: unknown) => Promise<string>;
}

type FrozenLangChainTool = <T>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T>,
) => LangChainToolFields;

type FrozenAiSdkTool = <T, S>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T> & { readonly jsonSchema: (schema: unknown) => S },
) => {
  readonly description: string;
  readonly inputSchema: S;
  readonly execute: (input: unknown) => Promise<unknown>;
};

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only frozen surface`);
}

const langchainTool: FrozenLangChainTool = () => unimplemented('langchainTool');
const aiSdkTool: FrozenAiSdkTool = () => unimplemented('aiSdkTool');

function frameworkContracts(schema: CoreSchema<string>): void {
  const validate = (value: unknown): { readonly value: string } => ({ value: String(value) });
  const execute = (input: { readonly value: string }): string => input.value;

  const langchain = new DynamicStructuredTool(
    langchainTool('echo', schema, {
      description: 'Echo one value',
      validate,
      execute,
    }),
  );

  const aiSdk = tool(
    aiSdkTool('echo', schema, {
      jsonSchema,
      description: 'Echo one value',
      validate,
      execute,
    }),
  );

  void langchain;
  void aiSdk;
}

void frameworkContracts;
