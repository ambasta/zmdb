// LLM function-calling harness — see ./SPEC.md.
import type { CoreSchema } from '../index.ts';
import { toJsonSchema, type JsonSchemaObject } from '../openapi/index.ts';

export interface ToolSpec {
  name: string;
  description?: string;
  parameters: JsonSchemaObject;
}

export function toolFromSchema(
  _name: string,
  _schema: CoreSchema<string>,
  _opts?: { description?: string },
): ToolSpec {
  throw new Error('not implemented');
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly string[];
}

export function lenientParse<T = unknown>(_text: string, _coerce?: (v: unknown) => T): ParseResult<T> {
  throw new Error('not implemented');
}

// re-exported for impl reuse
export { toJsonSchema };
