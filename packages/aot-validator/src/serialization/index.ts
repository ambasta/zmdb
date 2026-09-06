// AOT serialization — implementation.
// #52 stringify + parse implemented. #53 assertStringify remains unimplemented.
import { assert, AssertError, type TypeIR, type ValidationIssue } from '../utilities/index.js';

// Runtime fallback serializer. Byte-identical to JSON.stringify for supported
// values; bigint throws TypeError (documented policy). The AOT transformer will
// later emit straight-line concatenation for known shapes, but the observable
// contract is exactly this.
export function stringify(value: unknown): string {
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  // Guard nested bigint too (JSON.stringify would throw its own TypeError,
  // but we normalize the message/behavior through this entry point).
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
    return v;
  });
}

export { compileFastStringifier, compileStringifier } from './fast-stringifier.js';

// `TypeIR`: the witness a user has is the generated one, and there is no longer a
// hand-written form of it to accept (REQ-TF-9).
export function assertStringify(value: unknown, schema?: TypeIR): string {
  // Validate first (throws AssertError on failure), then serialize.
  assert(value, schema);
  return stringify(value);
}

export interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly ValidationIssue[];
}

/**
 * Parse JSON without rebuilding the object graph. Reports malformed input as
 * structured issues instead of throwing.
 *
 * `T` is an *unvalidated* claim about the payload — exactly as much as
 * `JSON.parse` gives you, and no more. Use {@link decode} when you need the
 * claim checked against a schema.
 */
export function parse<T = unknown>(text: string): ParseResult<T> {
  try {
    // boundary: JSON.parse is `any` by definition; the caller's `T` is asserted,
    // not proven. `decode` is the proving variant.
    const data = JSON.parse(text) as T;
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
export function decode<T = unknown>(text: string, schema?: TypeIR): ParseResult<T> {
  const parsed = parse<T>(text);
  if (!parsed.success) return parsed;
  try {
    assert(parsed.data, schema);
    return parsed.data !== undefined ? { success: true, data: parsed.data } : { success: true };
  } catch (err) {
    const issues = err instanceof AssertError ? err.issues : [];
    return { success: false, issues };
  }
}
