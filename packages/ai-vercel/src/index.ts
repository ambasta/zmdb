import { toolFromSchema, type ToolSchema } from '@zmdb/ai';
import { executeToolAdapter, type ToolAdapterOptions } from '@zmdb/ai/tool-runtime';

export interface AiSdkToolOptions<T, Output, Schema> extends ToolAdapterOptions<T, Output> {
  /**
   * The AI SDK's branded `jsonSchema` factory. Injecting it keeps the brand
   * owned by the installed peer and avoids a cast or a runtime schema library.
   */
  readonly jsonSchema: (schema: unknown) => Schema;
}

/** The fields accepted by the AI SDK's `tool(...)` helper. */
export interface AiSdkToolFields<Schema, Output> {
  readonly description: string;
  readonly inputSchema: Schema;
  readonly execute: (input: unknown) => Promise<Output | string>;
}

export function aiSdkTool<T, Output, Schema>(
  name: string,
  schema: ToolSchema,
  options: AiSdkToolOptions<T, Output, Schema>,
): AiSdkToolFields<Schema, Output> {
  const inputSchema = options.jsonSchema(toolFromSchema(name, schema).parameters);
  return {
    description: options.description,
    inputSchema,
    async execute(input) {
      return executeToolAdapter(name, input, options);
    },
  };
}

export type { ToolAdapterOptions } from '@zmdb/ai/tool-runtime';
