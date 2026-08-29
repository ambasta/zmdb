// Validator utilities — implementation.
// #57 is<T> boolean guard implemented over the runtime TypeDescriptor.
// #58 assert, #59 validate, #60 equals/assertEquals, #61 random remain
// unimplemented; their tests stay red.
import type { ValidationIssue } from '../advanced/index.ts';

const NOT_IMPL = 'not implemented';

export interface TypeDescriptor {
  readonly kind: 'object' | 'string' | 'number' | 'boolean' | 'enum' | 'array';
  readonly fields?: Record<string, TypeDescriptor>;
  readonly of?: TypeDescriptor;
  readonly values?: readonly string[];
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

// Core structural check used by is<T>. Returns a boolean; allocation-free on
// the success path (no error objects built).
function matches(value: unknown, d: TypeDescriptor): boolean {
  switch (d.kind) {
    case 'string':
      if (typeof value !== 'string') return false;
      if (d.maxLength !== undefined && value.length > d.maxLength) return false;
      if (d.pattern !== undefined && !new RegExp(d.pattern).test(value)) return false;
      return true;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return false;
      if (d.minimum !== undefined && value < d.minimum) return false;
      return true;
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (d.values?.includes(value) ?? false);
    case 'array':
      if (!Array.isArray(value) || !d.of) return false;
      for (const item of value) if (!matches(item, d.of)) return false;
      return true;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const obj = value as Record<string, unknown>;
      for (const [key, fd] of Object.entries(d.fields ?? {})) {
        if (!matches(obj[key], fd)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function is<T = unknown>(input: unknown, descriptor?: TypeDescriptor): input is T {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  return matches(input, descriptor);
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
