// JSON serialization and validated parsing.

import { assert, AssertError, type TypeIR } from '../index.js';
import { type ValidateResult } from '../validation-error.js';

// Native JSON owns property traversal and toJSON calls. Primitive bigint is
// rejected before a root toJSON hook can run; native JSON rejects nested bigint.
export function stringify(value: unknown): string {
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  return JSON.stringify(value);
}

// `TypeIR`: the witness a user has is the generated one, and there is no longer a
// hand-written form of it to accept (REQ-TF-9).
export function assertStringify(value: unknown, schema?: TypeIR): string {
  // Validate first (throws AssertError on failure), then serialize.
  assert(value, schema);
  return stringify(value);
}

/** Parse JSON syntax into unknown data, retaining the native parsed object. */
export function parse(text: string): ValidateResult<unknown> {
  try {
    const data: unknown = JSON.parse(text);
    return { success: true, data };
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
}

// #54 — typed parse/decode: parse JSON then validate into T against a schema.
// Malformed JSON or a validation failure yields success:false with structured
// issues (exact paths).
export function decode<T = unknown>(text: string, schema?: TypeIR): ValidateResult<T> {
  const parsed = parse(text);
  if (!parsed.success) return parsed;
  try {
    const data = assert<T>(parsed.data, schema);
    return { success: true, data };
  } catch (err) {
    const issues =
      err instanceof AssertError
        ? err.issues
        : [{ path: 'input', message: err instanceof Error ? err.message : 'validation failed' }];
    return { success: false, issues };
  }
}
