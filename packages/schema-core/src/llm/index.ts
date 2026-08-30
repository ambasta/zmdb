// LLM function-calling harness — see ./SPEC.md.
import type { CoreSchema } from '../index.ts';
import { toJsonSchema, type JsonSchemaObject } from '../openapi/index.ts';

export interface ToolSpec {
  name: string;
  description?: string;
  parameters: JsonSchemaObject;
}

export function toolFromSchema(
  name: string,
  schema: CoreSchema<string>,
  opts?: { description?: string },
): ToolSpec {
  const parameters = toJsonSchema(schema, 'create');
  return opts?.description ? { name, description: opts.description, parameters } : { name, parameters };
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
  if (!coerce) return { success: true, data: parsed as T };
  try {
    return { success: true, data: coerce(parsed) };
  } catch (err) {
    return { success: false, errors: [err instanceof Error ? err.message : 'coercion failed'] };
  }
}

// re-exported for impl reuse
export { toJsonSchema };
