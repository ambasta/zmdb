import { DynamicStructuredTool } from '@langchain/core/tools';
import type { CoreSchema } from '@zmdb/schema-core';
import { aiSdkTool } from '@zmdb/schema-core/llm/ai-sdk';
import { langchainTool } from '@zmdb/schema-core/llm/langchain';
import { jsonSchema, tool } from 'ai';

// Compile-only real-package conformance for llm/adapters/SPEC.md.
// The fixture consumes the published subpaths rather than source-relative files.

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
