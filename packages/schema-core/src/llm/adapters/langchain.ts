import type { CoreSchema } from '../../index.js';
import type { JsonSchemaObject } from '../../openapi/index.js';
import { toolFromSchema } from '../index.js';
import { serialiseToolResult } from '../tool-runtime.js';
import { executeToolAdapter, type ToolAdapterOptions } from './runtime.js';

/**
 * The fields accepted by `new DynamicStructuredTool(...)`.
 *
 * Kept structural so this optional subpath does not import LangChain or its
 * runtime schema dependencies. The real-package consumer fixture checks this
 * shape against the tested peer version.
 */
export interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchemaObject;
  readonly func: (input: unknown) => Promise<string>;
}

export function langchainTool<T, Output>(
  name: string,
  schema: CoreSchema<string>,
  options: ToolAdapterOptions<T, Output>,
): LangChainToolFields {
  return {
    name,
    description: options.description,
    schema: toolFromSchema(name, schema).parameters,
    async func(input) {
      return serialiseToolResult(await executeToolAdapter(name, input, options));
    },
  };
}

export type { ToolAdapterOptions } from './runtime.js';
