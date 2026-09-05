// Migration-only forwarder. The coordinated cutover in #710 moves the adapter
// implementation here and removes the temporary schema-core dependency. The
// reverse direction is forbidden because @zmdb/ai already depends on schema-core.
import type { ToolSchema, ToolSpec } from '@zmdb/ai';
import type { ToolAdapterOptions } from '@zmdb/ai/tool-runtime';
import { langchainTool as schemaCoreLangchainTool } from '@zmdb/schema-core/llm/langchain';

export interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSpec['parameters'];
  readonly func: (input: unknown) => Promise<string>;
}

export function langchainTool<T, Output>(
  name: string,
  schema: ToolSchema,
  options: ToolAdapterOptions<T, Output>,
): LangChainToolFields {
  return schemaCoreLangchainTool(name, schema, options);
}

export type { ToolAdapterOptions } from '@zmdb/ai/tool-runtime';
