// The facts about an IR node that the emitted code and the runtime walker must agree on.
//
// REQ-AV-4 asks for identical accept/reject sets *and* identical issue paths from the
// emitted validator and the fallback walker. That is a property of two independent
// walks over the same IR, so anything both of them decide lives here rather than being
// written twice: what an `expected` string reads, and whether a union has a
// discriminant worth switching on.
//
// Nothing in this file builds JavaScript, so the runtime path can import it without
// dragging the emitter into a browser bundle.

import type { Constraints, ObjectIR, TypeIR } from './index.js';

/**
 * What a value at this position was supposed to be, as the `expected` field of a
 * `ValidationIssue`. Structural only — a bound that a value of the right *shape*
 * violated gets its own issue via `expectedForConstraint`.
 */
export function expectedOf(node: TypeIR): string {
  switch (node.kind) {
    case 'scalar':
      return node.scalar === 'date' ? 'Date' : node.scalar;
    case 'literal':
      return JSON.stringify(node.value);
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'unknown':
      return 'anything';
    case 'union':
      return node.members.map(expectedOf).join(' | ');
    case 'array':
      return 'array';
    case 'tuple':
      return `tuple of length ${node.elements.length}`;
    case 'object':
      return node.name ?? 'object';
    case 'ref':
      return node.name;
    case 'unsupported':
      // Reachable only through a bug: the emitter refuses an `unsupported` node
      // before any issue text is needed (plan D4). Naming it beats `undefined`.
      return `an unsupported type (${node.reason})`;
  }
}

export type ConstraintKeyword = keyof Constraints;

/** `minLength`, `3` → `'minLength 3'`. One spelling, used by both walks. */
export function expectedForConstraint(keyword: ConstraintKeyword, value: number | string): string {
  return `${keyword} ${value}`;
}

/** The `message` of an issue is always derived from its `expected`. */
export function messageFor(expected: string): string {
  return `expected ${expected}`;
}

export interface DiscriminantArm {
  readonly value: string | number | boolean;
  readonly node: ObjectIR;
}

export interface Discriminant {
  readonly key: string;
  readonly arms: readonly DiscriminantArm[];
}

/**
 * The property to switch on for a union of objects, when there is one.
 *
 * A union is discriminated when every member is an object and some property is
 * present, required and a distinct literal on all of them. The reflection deliberately
 * records no strategy (`reflect/SPEC.md` §10) — it says "this property is a literal",
 * and choosing what to do about that is this function's job.
 *
 * Worth doing for more than speed. Without a discriminant, a failing union can only
 * say "none of these arms matched" at the union's own path; with one, the failure is
 * reported *inside* the arm the value was clearly trying to be, so `input.radius` gets
 * named instead of the whole shape.
 *
 * The first qualifying key in the first member's declaration order wins, so the answer
 * does not depend on property iteration order elsewhere.
 */
export function discriminantOf(members: readonly TypeIR[]): Discriminant | undefined {
  if (members.length < 2) return undefined;
  const objects: ObjectIR[] = [];
  for (const member of members) {
    if (member.kind !== 'object') return undefined;
    objects.push(member);
  }

  const first = objects[0];
  if (!first) return undefined;

  for (const candidate of first.properties) {
    if (candidate.optional || candidate.type.kind !== 'literal') continue;
    const arms: DiscriminantArm[] = [];
    const seen = new Set<string>();
    let usable = true;
    for (const object of objects) {
      const property = object.properties.find(p => p.name === candidate.name);
      if (!property || property.optional || property.type.kind !== 'literal') {
        usable = false;
        break;
      }
      // `JSON.stringify` rather than the raw value so `1` and `'1'` are two arms
      // rather than one collision — the emitted switch compares with `===`.
      const key = JSON.stringify(property.type.value);
      if (seen.has(key)) {
        usable = false;
        break;
      }
      seen.add(key);
      arms.push({ value: property.type.value, node: object });
    }
    if (usable) return { key: candidate.name, arms };
  }
  return undefined;
}

/** `'circle' | 'square'`, for the message when no arm's discriminant matched. */
export function expectedForDiscriminant(discriminant: Discriminant): string {
  return discriminant.arms.map(arm => JSON.stringify(arm.value)).join(' | ');
}

/**
 * Whether excess properties are even defined for this node. A value can satisfy
 * several arms of an undiscriminated union, so "which arm's property list is the
 * declared one" has no answer there and neither walk checks it — see `emit/SPEC.md`.
 */
export function hasExcessCheck(node: TypeIR): boolean {
  switch (node.kind) {
    case 'object':
    case 'ref':
    case 'array':
    case 'tuple':
      return true;
    case 'union':
      return discriminantOf(node.members) !== undefined;
    default:
      return false;
  }
}
