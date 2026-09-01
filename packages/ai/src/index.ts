import { type CoreSchema, type ValidationIssue } from '@zmdb/schema';

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

export function lenientParse(text: string): ParseResult<unknown>;
export function lenientParse<T>(text: string, coerce: (v: unknown) => T): ParseResult<T>;
export function lenientParse(text: string, coerce?: (v: unknown) => unknown): ParseResult<unknown> {
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
    return makeParseResult({
      success: false,
      issues: [{ path: 'input', message: err instanceof Error ? err.message : 'invalid JSON' }],
    });
  }
  // Without a callback, the parsed payload remains unknown.
  if (!coerce) return makeParseResult({ success: true, data: parsed });
  try {
    return makeParseResult({ success: true, data: coerce(parsed) });
  } catch (err) {
    return makeParseResult({
      success: false,
      issues: [{ path: 'input', message: err instanceof Error ? err.message : 'coercion failed' }],
    });
  }
}

export { toolFor };
export type { ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from './providers.js';
