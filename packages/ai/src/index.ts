import type { CoreSchema } from '@zmdb/schema-core';

import { toolFor, type ToolOptions, type ToolSpec } from './providers.js';

export function toolFromSchema(name: string, schema: CoreSchema<string>, opts?: ToolOptions): ToolSpec {
  return toolFor('json-schema', name, schema, opts);
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly string[];
}

export function lenientParse(text: string): ParseResult<unknown>;
export function lenientParse<T>(text: string, coerce: (v: unknown) => T): ParseResult<T>;
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
  // boundary: untyped parsing returns ParseResult<unknown>.
  // Typed parsing requires an explicit `coerce` validation callback.
  if (!coerce) return { success: true, data: parsed as T };
  try {
    return { success: true, data: coerce(parsed) };
  } catch (err) {
    return { success: false, errors: [err instanceof Error ? err.message : 'coercion failed'] };
  }
}

export { toolFor };
export type { ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from './providers.js';
