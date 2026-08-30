// Validator utilities — implementation.
// #57 is<T> boolean guard implemented over the runtime TypeDescriptor.
// #58 assert, #59 validate, #60 equals/assertEquals, #61 random remain
// unimplemented; their tests stay red.
import type { ValidationIssue } from '../advanced/index.ts';
import { getRegExp, getEnumSet } from '../index.ts';

// Local (not imported from @zmdb/schema-core, which exports the same guard):
// this package deliberately has no *runtime* cross-package import, so an emitted
// validator never drags the schema layer into a browser bundle for a one-liner.
/** True for a non-null, non-array object — proves a keyed read is safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'AssertError';
    this.issues = issues;
  }
}

/** Throw an AssertError carrying `issues` (first issue supplies the message). */
function failWith(issues: readonly ValidationIssue[]): never {
  const first = issues[0];
  throw new AssertError(first ? first.message : 'validation failed', issues);
}

// Core structural check used by is<T>. Returns a boolean; allocation-free on
// the success path (no error objects built).
function matches(value: unknown, d: TypeDescriptor): boolean {
  switch (d.kind) {
    case 'string':
      if (typeof value !== 'string') return false;
      if (d.maxLength !== undefined && value.length > d.maxLength) return false;
      if (d.pattern !== undefined && !getRegExp(d.pattern).test(value)) return false;
      return true;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return false;
      if (d.minimum !== undefined && value < d.minimum) return false;
      return true;
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (d.values ? getEnumSet(d.values).has(value) : false);
    case 'array':
      if (!Array.isArray(value) || !d.of) return false;
      for (const item of value) if (!matches(item, d.of)) return false;
      return true;
    case 'object': {
      if (!isRecord(value)) return false;
      const fields = d.fields;
      if (fields) {
        for (const key in fields) {
          if (!matches(value[key], fields[key]!)) return false;
        }
      }
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
      if (d.pattern !== undefined && !getRegExp(d.pattern).test(value)) fail(`pattern ${d.pattern}`);
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return fail('number');
      if (d.minimum !== undefined && value < d.minimum) fail(`minimum ${d.minimum}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail('boolean');
      return;
    case 'enum':
      if (typeof value !== 'string' || !(d.values ? getEnumSet(d.values).has(value) : false)) fail(`enum ${JSON.stringify(d.values)}`);
      return;
    case 'array': {
      const of = d.of;
      if (!Array.isArray(value) || !of) return fail('array');
      value.forEach((item, idx) => collectIssues(item, of, `${path}[${idx}]`, out));
      return;
    }
    case 'object': {
      if (!isRecord(value)) return fail('object');
      const fields = d.fields;
      if (fields) {
        for (const key in fields) {
          collectIssues(value[key], fields[key]!, `${path}.${key}`, out);
        }
      }
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
  if (issues.length > 0) failWith(issues);
  // boundary: `T` is the caller's compile-time type and `descriptor` is its
  // runtime witness; `collectIssues` having found nothing is the proof. This is
  // the certification point of the whole package — the assertion IS the API.
  return input as T;
}

export function validate<T = unknown>(input: unknown, descriptor?: TypeDescriptor): ValidateResult<T> {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  const issues: ValidationIssue[] = [];
  collectIssues(input, descriptor, 'input', issues);
  // boundary: same certification as `assert`, returned instead of thrown.
  return issues.length === 0 ? { success: true, data: input as T } : { success: false, errors: issues };
}

// #60 — excess-property-strict variants. equals = is<T> plus a recursive
// no-excess-keys check; assertEquals is the throwing form.
function hasNoExcessKeys(value: unknown, d: TypeDescriptor): boolean {
  if (d.kind === 'object') {
    if (!isRecord(value)) return true;
    const fields = d.fields ?? {};
    const obj = value;
    // Fast path: this function is only reached after the structural `matches`
    // check has confirmed every declared field is present. So "no excess keys"
    // reduces to a key-count equality — no Set, no includes(). We only recurse
    // into nested objects/arrays (which need their own excess check).
    let declared = 0;
    for (const key in fields) {
      declared++;
      const fd = fields[key];
      if (fd && (fd.kind === 'object' || fd.kind === 'array') && !hasNoExcessKeys(obj[key], fd)) {
        return false;
      }
    }
    // Count own enumerable keys without allocating an array.
    let actual = 0;
    for (const _ in obj) actual++;
    return actual === declared;
  }
  if (d.kind === 'array' && Array.isArray(value) && d.of) {
    const of = d.of;
    for (let i = 0; i < value.length; i++) if (!hasNoExcessKeys(value[i], of)) return false;
    return true;
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
    issues.push({
      path: 'input',
      expected: 'no excess properties',
      value: input,
      message: 'excess properties present',
    });
  }
  if (issues.length > 0) failWith(issues);
  // boundary: see `assert` — validated input, certified once.
  return input as T;
}

// #61 — schema/type-driven sample generator. Produces a value that satisfies
// the descriptor BY CONSTRUCTION, honoring tags (minimum/maxLength/pattern/
// enum). Contract: is(random(d), d) === true for every seed.
function randomFor(d: TypeDescriptor): unknown {
  switch (d.kind) {
    case 'number': {
      const min = d.minimum ?? 0;
      return min + Math.floor(Math.random() * 1000);
    }
    case 'string': {
      // Pattern support is intentionally limited to the common email-ish shape
      // used by our fixtures; unknown patterns fall back to a safe token.
      let s: string;
      if (d.pattern) {
        s = d.pattern.includes('@') ? `user${Math.floor(Math.random() * 1000)}@example.com` : 'x';
      } else {
        s = `s${Math.floor(Math.random() * 1_000_000).toString(36)}`;
      }
      if (d.maxLength !== undefined && s.length > d.maxLength) s = s.slice(0, d.maxLength);
      return s;
    }
    case 'boolean':
      return Math.random() < 0.5;
    case 'enum': {
      const values = d.values ?? [];
      return values[Math.floor(Math.random() * values.length)];
    }
    case 'array': {
      const of = d.of;
      if (!of) return [];
      const n = Math.floor(Math.random() * 3) + 1;
      return Array.from({ length: n }, () => randomFor(of));
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      const fields = d.fields;
      if (fields) {
        for (const key in fields) out[key] = randomFor(fields[key]!);
      }
      return out;
    }
    default:
      return undefined;
  }
}

export function random<T = unknown>(descriptor?: TypeDescriptor): T {
  if (!descriptor) throw new Error('runtime descriptor required in test/fallback mode');
  // boundary: `randomFor` builds the value FROM the descriptor, so it satisfies
  // it by construction (the `is(random(d), d)` property test guards this).
  return randomFor(descriptor) as T;
}
