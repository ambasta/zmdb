// The runtime half of the validator: one walk over `TypeIR`.
//
// This is what runs before the build has transformed anything — `vitest`, `tsx`, a REPL
// — and what a call site falls back to when the emitter refused its type. So it is not a
// toy: REQ-AV-4 requires it to accept and reject **exactly** what the emitted code
// accepts and rejects, and to report the same issue at the same path. A fallback that
// disagrees with the compiled form is worse than no fallback, because the disagreement
// only shows up in production.
//
// Two things make that achievable rather than aspirational:
//
//  1. **One vocabulary.** Both walks read `TypeIR`. This file used to walk its own
//     `TypeDescriptor` shape, which is why the two paths had drifted into three
//     divergences by the time anyone measured: the emitted object check accepted an
//     array, the emitted number check accepted `NaN`, and the runtime pattern check
//     threw above 10 000 characters. `TypeDescriptor` survives as a legacy input that
//     `toIR` normalises, so old callers keep working and there is still one walk.
//  2. **One set of decisions.** Every `expected` string, and the question of whether a
//     union has a discriminant, comes from `../emit/shape.ts` — imported by the emitter
//     too. Those are the parts that would otherwise be written twice and drift.
//
// The differential suite (`differential.spec.ts`) feeds both paths the same corpora and
// asserts the two answers are identical, so the claim above is measured.

import type { ValidationIssue } from '@zmdb/schema-core';
import type { Constraints, ObjectIR, ScalarIR, TypeIR, UnionIR } from '@zmdb/schema-core/ir';

import {
  discriminantOf,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  messageFor,
  type ConstraintKeyword,
} from '../emit/shape.ts';
import { failWith } from '../errors.ts';
import { getCachedRegExp } from '../regex-complexity.ts';

export { AssertError, failWith } from '../errors.ts';

/** True for a non-null, non-array object — proves a keyed read is safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The pre-IR runtime schema shape. Kept because `benchmarks/` and several specs still
 * build one by hand, and because `Phase 7c` is where those go away; until then `toIR`
 * means there is one walker rather than two.
 */
export interface TypeDescriptor {
  readonly kind: 'object' | 'string' | 'number' | 'boolean' | 'enum' | 'array';
  readonly fields?: Record<string, TypeDescriptor>;
  readonly of?: TypeDescriptor;
  readonly values?: readonly string[];
  readonly minimum?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/** What every entry point in this file accepts. */
export type RuntimeSchema = TypeIR | TypeDescriptor;

export interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}

// ---------------------------------------------------------------------------
// The legacy bridge
// ---------------------------------------------------------------------------

/**
 * `kind` alone does not separate the two shapes: `'object'` and `'array'` are legal in
 * both. The distinguishing field is, which is also the honest test — a descriptor has
 * `fields`/`of`, an IR node has `properties`/`element`.
 */
function isDescriptor(schema: RuntimeSchema): schema is TypeDescriptor {
  switch (schema.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
      return true;
    case 'object':
      return !('properties' in schema);
    case 'array':
      return !('element' in schema);
    default:
      return false;
  }
}

function constraintsFrom(descriptor: TypeDescriptor): Constraints | undefined {
  const constraints: { minimum?: number; maxLength?: number; pattern?: string } = {};
  if (descriptor.minimum !== undefined) constraints.minimum = descriptor.minimum;
  if (descriptor.maxLength !== undefined) constraints.maxLength = descriptor.maxLength;
  if (descriptor.pattern !== undefined) constraints.pattern = descriptor.pattern;
  return Object.keys(constraints).length === 0 ? undefined : constraints;
}

function withConstraints(scalar: ScalarIR['scalar'], descriptor: TypeDescriptor): ScalarIR {
  const constraints = constraintsFrom(descriptor);
  return constraints ? { kind: 'scalar', scalar, constraints } : { kind: 'scalar', scalar };
}

/** A legacy `TypeDescriptor` as IR. Total: a malformed descriptor becomes a refusal. */
export function irFromDescriptor(descriptor: TypeDescriptor): TypeIR {
  switch (descriptor.kind) {
    case 'string':
      return withConstraints('string', descriptor);
    case 'number':
      return withConstraints('number', descriptor);
    case 'boolean':
      return { kind: 'scalar', scalar: 'boolean' };
    case 'enum':
      return { kind: 'union', members: (descriptor.values ?? []).map(value => ({ kind: 'literal', value })) };
    case 'array': {
      if (!descriptor.of) {
        return { kind: 'unsupported', reason: 'an array descriptor with no element type' };
      }
      return { kind: 'array', element: irFromDescriptor(descriptor.of) };
    }
    case 'object':
      return {
        kind: 'object',
        properties: Object.entries(descriptor.fields ?? {}).map(([name, field]) => ({
          name,
          type: irFromDescriptor(field),
          optional: false,
          readonly: false,
        })),
      };
  }
}

/** Normalise whichever shape a caller supplied. IR passes through untouched. */
export function toIR(schema: RuntimeSchema): TypeIR {
  return isDescriptor(schema) ? irFromDescriptor(schema) : schema;
}

// ---------------------------------------------------------------------------
// Resolving `ref`
// ---------------------------------------------------------------------------

/**
 * A recursive type reaches its own definition through `{ kind: 'ref', name }`, so the
 * walk needs a name → node table. It is built once per root and cached, because the
 * alternative is rebuilding it on every call for a shape that never changes.
 */
type RefTable = ReadonlyMap<string, ObjectIR>;

const REF_TABLES = new WeakMap<TypeIR & object, RefTable>();
const NO_REFS: RefTable = new Map();

function collectRefs(node: TypeIR, into: Map<string, ObjectIR>): void {
  switch (node.kind) {
    case 'object':
      if (node.name !== undefined) {
        if (into.has(node.name)) return;
        into.set(node.name, node);
      }
      for (const property of node.properties) collectRefs(property.type, into);
      return;
    case 'array':
      collectRefs(node.element, into);
      return;
    case 'tuple':
      for (const element of node.elements) collectRefs(element, into);
      return;
    case 'union':
      for (const member of node.members) collectRefs(member, into);
      return;
    default:
      return;
  }
}

function refsOf(root: TypeIR): RefTable {
  const cached = REF_TABLES.get(root);
  if (cached) return cached;
  const table = new Map<string, ObjectIR>();
  collectRefs(root, table);
  const result: RefTable = table.size === 0 ? NO_REFS : table;
  REF_TABLES.set(root, result);
  return result;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

/**
 * The shape half of a scalar test, without its bounds. Mirrors `scalarBase` in the
 * emitter line for line; both reject `NaN` and an invalid `Date`.
 */
function scalarMatches(scalar: ScalarIR['scalar'], value: unknown): boolean {
  switch (scalar) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return Number.isInteger(value);
    case 'bigint':
      return typeof value === 'bigint';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return value instanceof Date && !Number.isNaN(value.getTime());
  }
}

/**
 * Bounds, in the order the emitter emits them.
 *
 * A pattern is tested with a plain cached `RegExp` and **no input-length cap**. The old
 * `safeTestPattern` threw above 10 000 characters, which the emitted form — a literal
 * `/re/.test(v)` — has no way to reproduce, so the cap was a divergence disguised as a
 * safety feature. It also guarded the wrong boundary: a pattern comes from the author's
 * own `Pattern<…>` tag and is complexity-checked at build time, so the untrusted side is
 * the input, and refusing to answer about a long input is not a safe answer.
 */
function constraintsMatch(constraints: Constraints | undefined, value: unknown): boolean {
  if (!constraints) return true;
  if (constraints.minimum !== undefined && !((value as number) >= constraints.minimum)) return false;
  if (constraints.maximum !== undefined && !((value as number) <= constraints.maximum)) return false;
  const length = (value as { length?: number }).length;
  if (constraints.minLength !== undefined && !((length as number) >= constraints.minLength)) return false;
  if (constraints.maxLength !== undefined && !((length as number) <= constraints.maxLength)) return false;
  if (constraints.pattern !== undefined && !getCachedRegExp(constraints.pattern).test(value as string)) return false;
  return true;
}

function matches(value: unknown, node: TypeIR, refs: RefTable): boolean {
  switch (node.kind) {
    case 'unknown':
      return true;
    case 'null':
      return value === null;
    case 'undefined':
      return value === undefined;
    case 'literal':
      return value === node.value;
    case 'scalar':
      return scalarMatches(node.scalar, value) && constraintsMatch(node.constraints, value);
    case 'array': {
      if (!Array.isArray(value)) return false;
      if (!constraintsMatch(node.constraints, value)) return false;
      for (const item of value) if (!matches(item, node.element, refs)) return false;
      return true;
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== node.elements.length) return false;
      for (const [index, element] of node.elements.entries()) {
        if (!matches(value[index], element, refs)) return false;
      }
      return true;
    }
    case 'object':
      return objectMatches(value, node, refs, undefined);
    case 'union':
      return unionMatches(value, node, refs);
    case 'ref': {
      const target = refs.get(node.name);
      return target ? objectMatches(value, target, refs, undefined) : false;
    }
    case 'unsupported':
      // The emitter refuses to compile one of these, so the only way to be here is a
      // hand-built descriptor. Nothing satisfies a type we cannot describe.
      return false;
  }
}

/** `skip` is a discriminant the union has already established. */
function objectMatches(value: unknown, node: ObjectIR, refs: RefTable, skip: string | undefined): boolean {
  if (!isRecord(value)) return false;
  for (const property of node.properties) {
    if (property.name === skip) continue;
    const member = value[property.name];
    if (property.optional && member === undefined) continue;
    if (!matches(member, property.type, refs)) return false;
  }
  return true;
}

function unionMatches(value: unknown, node: UnionIR, refs: RefTable): boolean {
  if (node.members.length === 0) return false;
  const discriminant = discriminantOf(node.members);
  if (discriminant) {
    if (!isRecord(value)) return false;
    const tag = value[discriminant.key];
    for (const arm of discriminant.arms) {
      if (tag === arm.value) return objectMatches(value, arm.node, refs, discriminant.key);
    }
    return false;
  }
  for (const member of node.members) if (matches(value, member, refs)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// issues
// ---------------------------------------------------------------------------

function report(out: ValidationIssue[], path: string, expected: string, value: unknown): void {
  out.push({ path, expected, value, message: messageFor(expected) });
}

function constraintIssues(
  constraints: Constraints | undefined,
  value: unknown,
  path: string,
  out: ValidationIssue[],
): void {
  if (!constraints) return;
  const check = (keyword: ConstraintKeyword, ok: boolean, bound: number | string): void => {
    if (!ok) report(out, path, expectedForConstraint(keyword, bound), value);
  };
  const length = (value as { length?: number }).length;
  if (constraints.minimum !== undefined) {
    check('minimum', (value as number) >= constraints.minimum, constraints.minimum);
  }
  if (constraints.maximum !== undefined) {
    check('maximum', (value as number) <= constraints.maximum, constraints.maximum);
  }
  if (constraints.minLength !== undefined) {
    check('minLength', (length as number) >= constraints.minLength, constraints.minLength);
  }
  if (constraints.maxLength !== undefined) {
    check('maxLength', (length as number) <= constraints.maxLength, constraints.maxLength);
  }
  if (constraints.pattern !== undefined) {
    check('pattern', getCachedRegExp(constraints.pattern).test(value as string), constraints.pattern);
  }
}

function collectIssues(value: unknown, node: TypeIR, path: string, out: ValidationIssue[], refs: RefTable): void {
  switch (node.kind) {
    case 'unknown':
      return;
    case 'null':
    case 'undefined':
    case 'literal':
      if (!matches(value, node, refs)) report(out, path, expectedOf(node), value);
      return;
    case 'scalar':
      // The shape is reported first and stops the walk: `minLength 3` about a number
      // would be two issues where one is the truth.
      if (!scalarMatches(node.scalar, value)) report(out, path, expectedOf(node), value);
      else constraintIssues(node.constraints, value, path, out);
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        report(out, path, 'array', value);
        return;
      }
      constraintIssues(node.constraints, value, path, out);
      for (const [index, item] of value.entries()) {
        collectIssues(item, node.element, `${path}[${index}]`, out, refs);
      }
      return;
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== node.elements.length) {
        report(out, path, expectedOf(node), value);
        return;
      }
      for (const [index, element] of node.elements.entries()) {
        collectIssues(value[index], element, `${path}[${index}]`, out, refs);
      }
      return;
    }
    case 'object':
      objectIssues(value, node, path, out, refs);
      return;
    case 'union':
      unionIssues(value, node, path, out, refs);
      return;
    case 'ref': {
      const target = refs.get(node.name);
      if (target) objectIssues(value, target, path, out, refs);
      else report(out, path, node.name, value);
      return;
    }
    case 'unsupported':
      report(out, path, expectedOf(node), value);
      return;
  }
}

function objectIssues(value: unknown, node: ObjectIR, path: string, out: ValidationIssue[], refs: RefTable): void {
  if (!isRecord(value)) {
    report(out, path, expectedOf(node), value);
    return;
  }
  for (const property of node.properties) {
    const member = value[property.name];
    if (property.optional && member === undefined) continue;
    collectIssues(member, property.type, `${path}${accessorPath(property.name)}`, out, refs);
  }
}

function unionIssues(value: unknown, node: UnionIR, path: string, out: ValidationIssue[], refs: RefTable): void {
  const discriminant = discriminantOf(node.members);
  if (!discriminant) {
    // No arm to blame: one issue naming the whole union, at the union's own path.
    if (!matches(value, node, refs)) report(out, path, expectedOf(node), value);
    return;
  }
  if (!isRecord(value)) {
    report(out, path, expectedOf(node), value);
    return;
  }
  const tag = value[discriminant.key];
  for (const arm of discriminant.arms) {
    if (tag === arm.value) {
      objectIssues(value, arm.node, path, out, refs);
      return;
    }
  }
  // With a discriminant the failure is precise: the tag itself is wrong.
  report(out, `${path}${accessorPath(discriminant.key)}`, expectedForDiscriminant(discriminant), tag);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `.email`, or `["odd name"]` — the same spelling the emitter's `join` produces. */
function accessorPath(name: string): string {
  return IDENTIFIER.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

// ---------------------------------------------------------------------------
// excess
// ---------------------------------------------------------------------------

/**
 * Whether the value carries a property its type does not declare.
 *
 * Only ever called after `matches` has passed, which is what lets the all-required case
 * reduce to a key count: every declared property is known to be present, so "no excess"
 * is "the counts agree". Same reduction as the emitted form.
 */
function hasNoExcessKeys(value: unknown, node: TypeIR, refs: RefTable): boolean {
  switch (node.kind) {
    case 'object':
      return objectHasNoExcessKeys(value, node, refs);
    case 'array': {
      if (!Array.isArray(value) || !hasExcessCheck(node.element)) return true;
      for (const item of value) if (!hasNoExcessKeys(item, node.element, refs)) return false;
      return true;
    }
    case 'tuple': {
      if (!Array.isArray(value)) return true;
      for (const [index, element] of node.elements.entries()) {
        if (!hasExcessCheck(element)) continue;
        if (!hasNoExcessKeys(value[index], element, refs)) return false;
      }
      return true;
    }
    case 'union': {
      // A value can satisfy several arms of an undiscriminated union, so "which arm's
      // property list is the declared one" has no answer and neither walk asks it.
      const discriminant = discriminantOf(node.members);
      if (!discriminant || !isRecord(value)) return true;
      const tag = value[discriminant.key];
      for (const arm of discriminant.arms) {
        if (tag === arm.value) return objectHasNoExcessKeys(value, arm.node, refs);
      }
      return true;
    }
    case 'ref': {
      const target = refs.get(node.name);
      return target ? objectHasNoExcessKeys(value, target, refs) : true;
    }
    default:
      return true;
  }
}

function objectHasNoExcessKeys(value: unknown, node: ObjectIR, refs: RefTable): boolean {
  if (!isRecord(value)) return true;

  let allRequired = true;
  for (const property of node.properties) {
    if (property.optional) {
      allRequired = false;
      break;
    }
  }

  if (allRequired && node.properties.length > 0) {
    // No Set and no allocation: count own enumerable keys and compare.
    let actual = 0;
    for (const _ in value) {
      if (++actual > node.properties.length) return false;
    }
    if (actual !== node.properties.length) return false;
  } else {
    for (const key in value) {
      if (!node.properties.some(property => property.name === key)) return false;
    }
  }

  for (const property of node.properties) {
    if (!hasExcessCheck(property.type)) continue;
    const member = value[property.name];
    // `for…in undefined` throws, and an optional or nullable member may be neither an
    // object nor present. The emitted form guards the same way.
    if (typeof member !== 'object' || member === null) continue;
    if (!hasNoExcessKeys(member, property.type, refs)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// sample
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomString(min: number, max: number): string {
  let s = '';
  while (s.length < Math.max(min, 1)) s += Math.random().toString(36).slice(2);
  return s.slice(0, max);
}

/**
 * A value that satisfies `node` by construction, or a thrown refusal.
 *
 * Refusing is the point. The generator this replaced returned `'x'` for any pattern it
 * did not recognise, so `is(random(d), d)` — the single property it claimed — was false
 * for most patterns. Nothing here inverts a regular expression, so it says so.
 *
 * No `RefTable`, unlike its siblings: a `ref` is where sampling stops, either dropped by
 * the union above it or refused outright, so there is never a name to resolve.
 */
function sample(node: TypeIR, path: string): unknown {
  switch (node.kind) {
    case 'unknown':
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'literal':
      return node.value;
    case 'scalar':
      return scalarSample(node, path);
    case 'array': {
      const min = node.constraints?.minLength ?? 1;
      const max = node.constraints?.maxLength ?? Math.max(min, 3);
      if (min > max) throw refusal(path, `an array with minLength ${min} above maxLength ${max}`);
      return Array.from({ length: randomInt(min, max) }, () => sample(node.element, `${path}[]`));
    }
    case 'tuple':
      return node.elements.map((element, index) => sample(element, `${path}[${index}]`));
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const property of node.properties) {
        out[property.name] = sample(property.type, `${path}.${property.name}`);
      }
      return out;
    }
    case 'union': {
      // A `ref` member is dropped rather than sampled, so `Node { next: Node | null }`
      // terminates on `null`. A union of nothing but refs cannot terminate at all.
      const usable = node.members.filter(member => member.kind !== 'ref');
      if (usable.length === 0) throw refusal(path, 'a union of nothing but back-references cannot be sampled');
      const chosen = usable[randomInt(0, usable.length - 1)] ?? usable[0];
      return sample(chosen as TypeIR, path);
    }
    case 'ref':
      throw refusal(path, `\`${node.name}\` recurs with no terminating arm, so no finite value satisfies it`);
    case 'unsupported':
      throw refusal(path, node.reason);
  }
}

function scalarSample(node: ScalarIR, path: string): unknown {
  const constraints = node.constraints;
  switch (node.scalar) {
    case 'boolean':
      return Math.random() < 0.5;
    case 'date':
      return new Date();
    case 'number':
    case 'integer':
    case 'bigint': {
      const min = constraints?.minimum ?? 0;
      const max = constraints?.maximum ?? min + 1000;
      if (min > max) throw refusal(path, `a bound with minimum ${min} above maximum ${max}`);
      const value = randomInt(min, max);
      return node.scalar === 'bigint' ? BigInt(value) : value;
    }
    case 'string': {
      if (constraints?.pattern !== undefined) {
        throw refusal(path, 'a sample cannot be built from a `pattern`; nothing here inverts a regular expression');
      }
      const min = constraints?.minLength ?? 1;
      const max = constraints?.maxLength ?? Math.max(min, 12);
      if (min > max) throw refusal(path, `a string with minLength ${min} above maxLength ${max}`);
      return randomString(min, max);
    }
  }
}

function refusal(path: string, reason: string): Error {
  return new Error(path === '' ? `cannot sample: ${reason}` : `cannot sample \`${path}\`: ${reason}`);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

const MISSING = 'runtime descriptor required in test/fallback mode';

function required(schema: RuntimeSchema | undefined): TypeIR {
  if (!schema) throw new Error(MISSING);
  return toIR(schema);
}

export function is<T = unknown>(input: unknown, schema?: RuntimeSchema): input is T {
  const node = required(schema);
  return matches(input, node, refsOf(node));
}

export function assert<T = unknown>(input: unknown, schema?: RuntimeSchema): T {
  const node = required(schema);
  const refs = refsOf(node);
  // Two passes, as the emitted form does it: the allocation-free check first, and the
  // issue walk only once we already know a throw is coming (REQ-AV-7).
  if (matches(input, node, refs)) {
    // boundary: `T` is the caller's compile-time type and `node` is its runtime
    // witness; the check having passed is the proof. This is the certification point
    // of the whole package — the assertion IS the API.
    return input as T;
  }
  const issues: ValidationIssue[] = [];
  collectIssues(input, node, 'input', issues, refs);
  failWith(issues);
}

export function validate<T = unknown>(input: unknown, schema?: RuntimeSchema): ValidateResult<T> {
  const node = required(schema);
  const refs = refsOf(node);
  // boundary: same certification as `assert`, returned instead of thrown.
  if (matches(input, node, refs)) return { success: true, data: input as T };
  const issues: ValidationIssue[] = [];
  collectIssues(input, node, 'input', issues, refs);
  return { success: false, errors: issues };
}

export function equals<T = unknown>(input: unknown, schema?: RuntimeSchema): input is T {
  const node = required(schema);
  const refs = refsOf(node);
  return matches(input, node, refs) && hasNoExcessKeys(input, node, refs);
}

export function assertEquals<T = unknown>(input: unknown, schema?: RuntimeSchema): T {
  const node = required(schema);
  const refs = refsOf(node);
  if (matches(input, node, refs) && hasNoExcessKeys(input, node, refs)) {
    // boundary: see `assert` — validated input, certified once.
    return input as T;
  }
  const issues: ValidationIssue[] = [];
  collectIssues(input, node, 'input', issues, refs);
  // Excess properties are one issue about the value as a whole, and only worth
  // reporting when nothing else was wrong: "you also passed `extra`" is noise next to
  // "`email` is not a string".
  if (issues.length === 0 && !hasNoExcessKeys(input, node, refs)) {
    report(issues, 'input', 'no excess properties', input);
  }
  failWith(issues);
}

export function random<T = unknown>(schema?: RuntimeSchema): T {
  const node = required(schema);
  // boundary: `sample` builds the value FROM the IR, so it satisfies it by
  // construction — the `is(random(d), d)` property test guards this.
  return sample(node, '') as T;
}

/** Every issue, for a caller that wants them without a `ValidateResult` wrapper. */
export function issuesFor(input: unknown, schema: RuntimeSchema, path = 'input'): readonly ValidationIssue[] {
  const node = toIR(schema);
  const issues: ValidationIssue[] = [];
  collectIssues(input, node, path, issues, refsOf(node));
  return issues;
}

export type { ValidationIssue };
