// AOT serialization — API stubs (red phase). Implementation in #52–#55.
import type { ValidationIssue } from '../advanced/index.ts';

const NOT_IMPL = 'not implemented';

export function stringify(_value: unknown): string {
  throw new Error(NOT_IMPL);
}

export function assertStringify(_value: unknown): string {
  throw new Error(NOT_IMPL);
}

export interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly ValidationIssue[];
}

export function parse<T = unknown>(_text: string): ParseResult<T> {
  throw new Error(NOT_IMPL);
}
