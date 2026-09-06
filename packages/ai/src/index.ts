import type { CoreSchema, ValidationIssue } from '@zmdb/schema-core';

import { toolFor, type ToolOptions, type ToolSpec } from './providers.js';

export function toolFromSchema(name: string, schema: CoreSchema<string>, opts?: ToolOptions): ToolSpec {
  return toolFor('json-schema', name, schema, opts);
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  issues?: readonly ValidationIssue[];
  /** @deprecated Use `issues` instead. */
  errors?: readonly ValidationIssue[];
}

function makeParseResult<T>(params: {
  success: boolean;
  data?: T;
  issues?: readonly ValidationIssue[];
}): ParseResult<T> {
  const result: ParseResult<T> = {
    success: params.success,
    ...(params.data !== undefined ? { data: params.data } : {}),
    ...(params.issues !== undefined ? { issues: params.issues } : {}),
  };
  Object.defineProperty(result, 'errors', {
    get() {
      console.warn('DeprecationWarning: "errors" property is deprecated, use "issues" instead.');
      return this.issues;
    },
    enumerable: true,
    configurable: true,
  });
  return result;
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
    return makeParseResult<T>({
      success: false,
      issues: [{ path: 'input', message: err instanceof Error ? err.message : 'invalid JSON' }],
    });
  }
  // boundary: with no `coerce` there is nothing to check the payload against —
  // `T` is the caller's claim about the model's output, exactly as with
  // `JSON.parse`. Pass a `coerce` (or run the AOT validator) to make it proven.
  if (!coerce) return makeParseResult<T>({ success: true, data: parsed as T });
  try {
    return makeParseResult<T>({ success: true, data: coerce(parsed) });
  } catch (err) {
    return makeParseResult<T>({
      success: false,
      issues: [{ path: 'input', message: err instanceof Error ? err.message : 'coercion failed' }],
    });
  }
}

export { toolFor };
export type { ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from './providers.js';
