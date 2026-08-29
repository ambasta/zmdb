// AOT serialization — implementation.
// #52 stringify + parse implemented. #53 assertStringify remains unimplemented.
import type { ValidationIssue } from '../advanced/index.ts';
import { assert, type TypeDescriptor } from '../utilities/index.ts';


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

export function assertStringify(value: unknown, descriptor?: TypeDescriptor): string {
  // Validate first (throws AssertError on failure), then serialize.
  assert(value, descriptor);
  return stringify(value);
}

export interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly ValidationIssue[];
}

export function parse<T = unknown>(text: string): ParseResult<T> {
  try {
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
