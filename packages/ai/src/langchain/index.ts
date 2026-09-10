// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { toolFromSchema, type ToolSchema, type ToolSpec } from '../index.js';
import { executeToolAdapter, serialiseToolResult, type ToolAdapterOptions } from '../tool-runtime.js';

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
  readonly schema: ToolSpec['parameters'];
  readonly func: (input: unknown) => Promise<string>;
}

export function langchainTool<T, Output>(
  name: string,
  schema: ToolSchema,
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

export type { ToolAdapterOptions } from '../tool-runtime.js';
