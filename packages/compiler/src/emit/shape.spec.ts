// The vocabulary both walks read out of, asked directly.
//
// `differential.spec.ts` proves the emitted validator and the runtime walker agree on every
// input in a corpus, which is the strong statement — and it is a statement about pairs of
// walks, so when it fails it says "these two disagree" rather than what either of them should
// have said. These helpers are where the agreement actually comes from: one function decides
// what `expected` reads, one decides whether a union has a tag worth switching on, and both
// walks call them. Written out here, each is a claim that can be wrong on its own.
//
// The last test in each block closes the loop back to the runtime walker, because a helper
// that is right and unused is the failure this file would otherwise miss.

import { equals, issuesFor } from '@zmdb/aot-validator/utilities';
import type { ObjectIR, TypeIR } from '@zmdb/schema-core/ir';
import {
  discriminantOf,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  messageFor,
} from '@zmdb/schema-core/ir';
import { describe, expect, it } from 'vitest';

/** A required, mutable property, which is what all but one case below wants. */
const property = (name: string, type: TypeIR, optional = false) => ({ name, type, optional, readonly: false });

const literal = (value: string | number | boolean): TypeIR => ({ kind: 'literal', value });

const circle: ObjectIR = {
  kind: 'object',
  name: 'Circle',
  properties: [property('kind', literal('circle')), property('radius', { kind: 'scalar', scalar: 'number' })],
};
const square: ObjectIR = {
  kind: 'object',
  name: 'Square',
  properties: [property('kind', literal('square')), property('side', { kind: 'scalar', scalar: 'number' })],
};

describe('expectedOf', () => {
  it('names every kind of node, so no issue can say `undefined`', () => {
    // Total over `TypeIR`, deliberately: an `expected` of `undefined` is what a missing case
    // produces, and it reads like a claim about the type rather than a hole in the walker.
    expect(expectedOf({ kind: 'scalar', scalar: 'string' })).toBe('string');
    expect(expectedOf({ kind: 'scalar', scalar: 'integer' })).toBe('integer');
    // `date` is the one scalar whose IR name is not the name a reader would recognise: the
    // app-layer value is a `Date`, and `expected 'date'` would read as a wire format.
    expect(expectedOf({ kind: 'scalar', scalar: 'date' })).toBe('Date');
    expect(expectedOf(literal('admin'))).toBe('"admin"');
    expect(expectedOf(literal(7))).toBe('7');
    expect(expectedOf(literal(true))).toBe('true');
    expect(expectedOf({ kind: 'null' })).toBe('null');
    expect(expectedOf({ kind: 'undefined' })).toBe('undefined');
    expect(expectedOf({ kind: 'unknown' })).toBe('anything');
    expect(expectedOf({ kind: 'array', element: { kind: 'scalar', scalar: 'number' } })).toBe('array');
    expect(expectedOf({ kind: 'tuple', elements: [{ kind: 'scalar', scalar: 'number' }] })).toBe('tuple of length 1');
    expect(expectedOf(circle)).toBe('Circle');
    expect(expectedOf({ kind: 'object', properties: [] })).toBe('object');
    expect(expectedOf({ kind: 'ref', name: 'Tree' })).toBe('Tree');
    expect(expectedOf({ kind: 'unsupported', reason: 'index signature' })).toBe(
      'an unsupported type (index signature)',
    );
  });

  it('spells a union as its members, recursively', () => {
    expect(
      expectedOf({
        kind: 'union',
        members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'null' }],
      }),
    ).toBe('string | null');
    expect(expectedOf({ kind: 'union', members: [literal('a'), literal('b'), literal(1)] })).toBe('"a" | "b" | 1');
  });

  it('is what the runtime walker puts in the issue it reports', () => {
    const node: TypeIR = { kind: 'scalar', scalar: 'date' };
    const [issue] = issuesFor('2026-01-01', node);
    expect(issue?.expected).toBe(expectedOf(node));
    expect(issue?.message).toBe(messageFor(expectedOf(node)));
  });
});

describe('expectedForConstraint and messageFor', () => {
  it('names the bound rather than the shape, because the shape was fine', () => {
    expect(expectedForConstraint('minLength', 3)).toBe('minLength 3');
    expect(expectedForConstraint('minimum', 0)).toBe('minimum 0');
    expect(expectedForConstraint('pattern', '^[a-z]+$')).toBe('pattern ^[a-z]+$');
  });

  it('is one prefix in one place, so both walks phrase a failure the same way', () => {
    expect(messageFor('string')).toBe('expected string');
    expect(messageFor(expectedForConstraint('minimum', 0))).toBe('expected minimum 0');

    // A value of the right shape that violates a bound gets the bound's issue, not `expected
    // number` — which is the distinction the two functions exist to keep.
    const node: TypeIR = { kind: 'scalar', scalar: 'number', constraints: { minimum: 0 } };
    const [issue] = issuesFor(-1, node);
    expect(issue?.expected).toBe(expectedForConstraint('minimum', 0));
    expect(issue?.message).toBe('expected minimum 0');
  });
});

describe('discriminantOf', () => {
  it('finds the tag every arm agrees on, and its arms in declaration order', () => {
    const found = discriminantOf([circle, square]);
    expect(found?.key).toBe('kind');
    expect(found?.arms.map(a => a.value)).toEqual(['circle', 'square']);
    expect(found?.arms[0]?.node).toBe(circle);
  });

  it('takes the first qualifying key, so the answer does not depend on iteration order', () => {
    // Two keys qualify here. Declaration order decides, and it has to decide the same way in
    // both walks or one reports `input.kind` where the other reports `input.version`.
    const a: ObjectIR = { kind: 'object', properties: [property('kind', literal('a')), property('v', literal(1))] };
    const b: ObjectIR = { kind: 'object', properties: [property('kind', literal('b')), property('v', literal(2))] };
    expect(discriminantOf([a, b])?.key).toBe('kind');
  });

  it('refuses a union it cannot switch on, rather than guessing a tag', () => {
    // Each of these is a way the switch would be wrong, not merely absent. A one-member union
    // has nothing to distinguish; a non-object arm has no property to read; an optional or
    // non-literal tag can be missing at runtime; and a repeated value would make one arm
    // unreachable behind another that compares equal to it.
    expect(discriminantOf([circle])).toBeUndefined();
    expect(discriminantOf([circle, { kind: 'scalar', scalar: 'string' }])).toBeUndefined();
    expect(
      discriminantOf([circle, { kind: 'object', properties: [property('kind', literal('square'), true)] }]),
    ).toBeUndefined();
    expect(
      discriminantOf([
        circle,
        { kind: 'object', properties: [property('kind', { kind: 'scalar', scalar: 'string' })] },
      ]),
    ).toBeUndefined();
    expect(discriminantOf([circle, { ...square, properties: [property('kind', literal('circle'))] }])).toBeUndefined();
    // A member with no such property at all: the tag is not on every arm.
    expect(discriminantOf([circle, { kind: 'object', properties: [property('side', literal(1))] }])).toBeUndefined();
  });

  it('keeps 1 and "1" apart, because the emitted switch compares with ===', () => {
    const numeric: ObjectIR = { kind: 'object', properties: [property('v', literal(1))] };
    const stringy: ObjectIR = { kind: 'object', properties: [property('v', literal('1'))] };
    expect(discriminantOf([numeric, stringy])?.arms.map(a => a.value)).toEqual([1, '1']);
  });

  it('is why a failing union blames the tag instead of the whole shape', () => {
    const union: TypeIR = { kind: 'union', members: [circle, square] };
    const paths = issuesFor({ kind: 'triangle', radius: 1 }, union).map(i => i.path);
    expect(paths).toEqual(['input.kind']);
    // And the message lists the arms, which is `expectedForDiscriminant`'s answer.
    const [issue] = issuesFor({ kind: 'triangle', radius: 1 }, union);
    expect(issue?.expected).toBe('"circle" | "square"');
  });
});

describe('expectedForDiscriminant', () => {
  it('lists the tag values a caller could have sent', () => {
    const found = discriminantOf([circle, square]);
    expect(found).toBeDefined();
    expect(expectedForDiscriminant(found as never)).toBe('"circle" | "square"');
  });
});

describe('hasExcessCheck', () => {
  it('is true exactly where a declared property list exists to compare against', () => {
    expect(hasExcessCheck(circle)).toBe(true);
    expect(hasExcessCheck({ kind: 'ref', name: 'Tree' })).toBe(true);
    expect(hasExcessCheck({ kind: 'array', element: circle })).toBe(true);
    expect(hasExcessCheck({ kind: 'tuple', elements: [circle] })).toBe(true);
    expect(hasExcessCheck({ kind: 'scalar', scalar: 'string' })).toBe(false);
    expect(hasExcessCheck(literal('a'))).toBe(false);
    expect(hasExcessCheck({ kind: 'null' })).toBe(false);
    expect(hasExcessCheck({ kind: 'unknown' })).toBe(false);
    expect(hasExcessCheck({ kind: 'unsupported', reason: 'index signature' })).toBe(false);
  });

  it('follows the discriminant for a union, because that is what picks the arm', () => {
    // A discriminated union has one declared property list per tag value, so excess is well
    // defined. Without a tag it is not: a value can satisfy two arms, and "which arm's
    // properties are the declared ones" has no answer, so neither walk asks.
    expect(hasExcessCheck({ kind: 'union', members: [circle, square] })).toBe(true);
    expect(hasExcessCheck({ kind: 'union', members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'null' }] })).toBe(
      false,
    );
    expect(
      hasExcessCheck({
        kind: 'union',
        members: [circle, { kind: 'object', properties: [property('side', literal(1))] }],
      }),
    ).toBe(false);
  });

  it('decides whether `equals` rejects an extra key, on the same input either way', () => {
    // `is` never checks excess, so this is `equals`' question. One value, two unions that
    // differ only in whether a tag exists, and the answer tracks this function — which is the
    // whole reason it is a function rather than a `switch` written out in each walk.
    const tagged: TypeIR = { kind: 'union', members: [circle, square] };
    const untagged: TypeIR = { kind: 'union', members: [circle, { kind: 'object', properties: [] }] };
    const value = { kind: 'circle', radius: 1, extra: true };
    expect(hasExcessCheck(tagged)).toBe(true);
    expect(equals(value, tagged)).toBe(false);
    expect(hasExcessCheck(untagged)).toBe(false);
    expect(equals(value, untagged)).toBe(true);
    // Both accept it structurally, so `equals` is the only thing that separated them.
    expect(issuesFor(value, tagged)).toEqual([]);
    expect(issuesFor(value, untagged)).toEqual([]);
  });
});
