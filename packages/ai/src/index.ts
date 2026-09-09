import { type CoreSchema } from '@zmdb/schema';
import { AssertError, validationIssuesOf, type ValidateResult } from '@zmdb/validator';

import { toolFor, type ToolOptions, type ToolSpec } from './providers.js';

export function toolFromSchema(name: string, schema: CoreSchema<string>, opts?: ToolOptions): ToolSpec {
  return toolFor('json-schema', name, schema, opts);
}

export function lenientParse(text: string): ValidateResult<unknown>;
export function lenientParse<T>(text: string, coerce: (v: unknown) => T): ValidateResult<T>;
export function lenientParse(text: string, coerce?: (v: unknown) => unknown): ValidateResult<unknown> {
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
    return {
      success: false,
      issues: [
        {
          path: 'input',
          expected: 'valid JSON',
          value: text,
          message: err instanceof Error ? err.message : 'invalid JSON',
        },
      ],
    };
  }
  // Without a callback, the parsed payload remains unknown.
  if (!coerce) return { success: true, data: parsed };
  try {
    return { success: true, data: coerce(parsed) };
  } catch (err) {
    return {
      success: false,
      issues:
        err instanceof AssertError
          ? err.issues
          : (validationIssuesOf(err) ?? [
              { path: 'input', message: err instanceof Error ? err.message : 'coercion failed' },
            ]),
    };
  }
}

export { toolFor };
export type { ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from './providers.js';
