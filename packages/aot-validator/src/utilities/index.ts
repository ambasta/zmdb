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

// Path-aware failure collection (shared by assert/validate). Reports exact
// paths like `input.id` or `input.items[2]`.
function collectIssues(value: unknown, d: TypeDescriptor, path: string, out: ValidationIssue[]): void {
  const fail = (expected: string): void => {
    out.push({ path, expected, value, message: `expected ${expected}` });
  };

  switch (d.kind) {
    case 'string':
      if (typeof value !== 'string') return fail('string');
      if (d.maxLength !== undefined && value.length > d.maxLength) fail(`maxLength ${d.maxLength}`);
      if (d.pattern !== undefined && !new RegExp(d.pattern).test(value)) fail(`pattern ${d.pattern}`);
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return fail('number');
      if (d.minimum !== undefined && value < d.minimum) fail(`minimum ${d.minimum}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail('boolean');
      return;
    case 'enum':
      if (typeof value !== 'string' || !(d.values?.includes(value) ?? false)) fail(`enum ${JSON.stringify(d.values)}`);
      return;
    case 'array':
      if (!Array.isArray(value) || !d.of) return fail('array');
      value.forEach((item, idx) => collectIssues(item, d.of!, `${path}[${idx}]`, out));
      return;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('object');
      const obj = value as Record<string, unknown>;
      for (const [key, fd] of Object.entries(d.fields ?? {})) {
        collectIssues(obj[key], fd, `${path}.${key}`, out);
      }
      return;
    }
    default:
      return;
  }
}

export function assert<T = unknown>(input: unknown, descriptor?: TypeDescriptor): T {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  const issues: ValidationIssue[] = [];
  collectIssues(input, descriptor, 'input', issues);
  if (issues.length > 0) {
    const err = new AssertError(issues[0]!.message);
    (err as { issues: readonly ValidationIssue[] }).issues = issues;
    throw err;
  }
  return input as T;
}

export function validate<T = unknown>(
  input: unknown,
  descriptor?: TypeDescriptor,
): ValidateResult<T> {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  const issues: ValidationIssue[] = [];
  collectIssues(input, descriptor, 'input', issues);
  return issues.length === 0 ? { success: true, data: input as T } : { success: false, errors: issues };
}

// #60 — excess-property-strict variants. equals = is<T> plus a recursive
// no-excess-keys check; assertEquals is the throwing form.
function hasNoExcessKeys(value: unknown, d: TypeDescriptor): boolean {
  if (d.kind === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return true;
    const allowed = new Set(Object.keys(d.fields ?? {}));
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) return false;
      const fd = d.fields?.[k];
      if (fd && !hasNoExcessKeys(obj[k], fd)) return false;
    }
    return true;
  }
  if (d.kind === 'array' && Array.isArray(value) && d.of) {
    return value.every((item) => hasNoExcessKeys(item, d.of!));
  }
  return true;
}

export function equals<T = unknown>(input: unknown, descriptor?: TypeDescriptor): input is T {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  return matches(input, descriptor) && hasNoExcessKeys(input, descriptor);
}

export function assertEquals<T = unknown>(input: unknown, descriptor?: TypeDescriptor): T {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  const issues: ValidationIssue[] = [];
  collectIssues(input, descriptor, 'input', issues);
  if (issues.length === 0 && !hasNoExcessKeys(input, descriptor)) {
    issues.push({ path: 'input', expected: 'no excess properties', value: input, message: 'excess properties present' });
  }
  if (issues.length > 0) {
    const err = new AssertError(issues[0]!.message);
    (err as { issues: readonly ValidationIssue[] }).issues = issues;
    throw err;
  }
  return input as T;
}

export function random<T = unknown>(_descriptor?: TypeDescriptor): T {
  throw new Error(NOT_IMPL);
}
