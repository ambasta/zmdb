// LLM function-calling harness — see ./SPEC.md.
import type { CoreSchema } from '../index.js';
import { toJsonSchema } from '../openapi/index.js';
import { toolFor, type ToolOptions, type ToolSpec } from './providers.js';

export function toolFromSchema(name: string, schema: CoreSchema<string>, opts?: ToolOptions): ToolSpec {
  return toolFor('json-schema', name, schema, opts);
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly string[];
}

export function lenientParse<T = unknown>(text: string, coerce?: (v: unknown) => T): ParseResult<T> {
  // strip a leading/trailing markdown code fence (```json … ```)
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { success: false, errors: [err instanceof Error ? err.message : 'invalid JSON'] };
  }
  // boundary: with no `coerce` there is nothing to check the payload against —
  // `T` is the caller's claim about the model's output, exactly as with
  // `JSON.parse`. Pass a `coerce` (or run the AOT validator) to make it proven.
  if (!coerce) return { success: true, data: parsed as T };
  try {
    return { success: true, data: coerce(parsed) };
  } catch (err) {
    return { success: false, errors: [err instanceof Error ? err.message : 'coercion failed'] };
  }
}

// re-exported for impl reuse
export { toJsonSchema };
export * from './providers.js';
export * from './chat/index.js';
export * from './http/index.js';
export * from './mcp/index.js';
