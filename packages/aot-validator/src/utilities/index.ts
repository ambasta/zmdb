// Validator utilities — API stubs (red phase). Implementation in #57–#61.
import type { ValidationIssue } from '../advanced/index.ts';

const NOT_IMPL = 'not implemented';

// Minimal runtime type descriptor threaded in by the transformer.
// For tests, callers pass it explicitly.
export interface TypeDescriptor {
  readonly kind: 'object' | 'string' | 'number' | 'boolean' | 'enum' | 'array';
  readonly fields?: Record<string, TypeDescriptor>;
  readonly of?: TypeDescriptor; // array element
  readonly values?: readonly string[]; // enum
  readonly minimum?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}

export class AssertError extends Error {
  readonly issues: readonly ValidationIssue[] = [];
}

export function is<T = unknown>(_input: unknown, _descriptor?: TypeDescriptor): _input is T {
  throw new Error(NOT_IMPL);
}

export function assert<T = unknown>(_input: unknown, _descriptor?: TypeDescriptor): T {
  throw new Error(NOT_IMPL);
}

export function validate<T = unknown>(
  _input: unknown,
  _descriptor?: TypeDescriptor,
): ValidateResult<T> {
  throw new Error(NOT_IMPL);
}

export function equals<T = unknown>(_input: unknown, _descriptor?: TypeDescriptor): _input is T {
  throw new Error(NOT_IMPL);
}

export function assertEquals<T = unknown>(_input: unknown, _descriptor?: TypeDescriptor): T {
  throw new Error(NOT_IMPL);
}

export function random<T = unknown>(_descriptor?: TypeDescriptor): T {
  throw new Error(NOT_IMPL);
}
