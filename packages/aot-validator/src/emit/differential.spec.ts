// REQ-AV-4: the emitted check and the runtime walker are the same validator.
//
// There are two implementations of "does this value match this type" in the repo, and the
// whole promise of the AOT validator is that choosing between them is a performance
// decision and nothing else. That is not something a reading of the code can establish —
// the three divergences found while writing it (an emitted object check that accepted
// arrays, an emitted number check that accepted `NaN`, a runtime pattern check that threw
// above 10 000 characters) all looked fine in review — so it is settled by measurement:
// feed both the same values and require the same answers.
//
// "The same answers" is deliberately strict. Not just the same accept/reject sets, but the
// same issue list: same paths, same `expected` strings, same order. A validator that
// rejects the right things while blaming the wrong field has still changed behaviour when
// a build turns the AOT path on.

import type { TypeIR } from '@zmdb/schema-core/ir';
import { afterAll, describe, expect, it } from 'vitest';

import { equals, is, issuesFor, type ValidationIssue } from '../utilities/index.js';
import { FixtureProject } from './__testing__/project.js';

const DECLARATIONS = `  interface User { id: number & Min<1>; email: string & Pattern<"^[^@]+@[^@]+$">; nickname?: string }
  interface Tree { value: number; children: Tree[] }
  interface Bounded { name: string & MinLength<2> & MaxLength<5>; score: number & Min<0> & Max<10> }
  interface Nested { user: User; labels: string[] }
  interface Odd { "not-an-ident": number; ok: boolean }
  type Shape = { kind: "circle"; r: number & Min<0> } | { kind: "square"; side: number };
  type Loose = { a: number } | { b: string };
  type Colour = "red" | "green" | "blue";
  type Mixed = string | number | null;
  type Pair = [number, string];
  type Maybe = User | null;`;

/**
 * Values thrown at every type, so each check is asked about shapes it was not written
 * for. Most of the historical divergences were here rather than in the plausible values:
 * `NaN` is a number, `[]` is an object, `null` is both and neither.
 */
const WILD: readonly unknown[] = [
  undefined,
  null,
  0,
  1,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '',
  'a',
  'red',
  true,
  false,
  [],
  [1],
  ['a'],
  {},
  { a: 1 },
  { b: 'x' },
  { kind: 'circle' },
  new Date(0),
  () => 0,
];

interface Case {
  readonly type: string;
  /** Values chosen for this type specifically, on top of `WILD`. */
  readonly values: readonly unknown[];
}

const CASES: readonly Case[] = [
  {
    type: 'User',
    values: [
      { id: 1, email: 'a@b' },
      { id: 1, email: 'a@b', nickname: 'x' },
      { id: 1, email: 'a@b', nickname: undefined },
      { id: 1, email: 'a@b', extra: 1 },
      { id: 0, email: 'a@b' },
      { id: 1, email: 'nope' },
      { id: 1, email: 'a@b@c' },
      { id: '1', email: 'a@b' },
      { id: Number.NaN, email: 'a@b' },
      { id: 1 },
      { email: 'a@b' },
      { id: 1, email: 'a@b', nickname: 7 },
    ],
  },
  {
    type: 'Tree',
    values: [
      { value: 1, children: [] },
      { value: 1, children: [{ value: 2, children: [] }] },
      { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] },
      { value: 1, children: [{ value: 'x', children: [] }] },
      { value: 1, children: [{ value: 2, children: [], extra: true }] },
      { value: 1, children: {} },
      { value: 1 },
    ],
  },
  {
    type: 'Bounded',
    values: [
      { name: 'ab', score: 0 },
      { name: 'abcde', score: 10 },
      { name: 'a', score: 5 },
      { name: 'abcdef', score: 5 },
      { name: 'abc', score: -1 },
      { name: 'abc', score: 11 },
      { name: 3, score: 5 },
      { name: 'abc', score: '5' },
    ],
  },
  {
    type: 'Nested',
    values: [
      { user: { id: 1, email: 'a@b' }, labels: [] },
      { user: { id: 1, email: 'a@b' }, labels: ['x', 'y'] },
      { user: { id: 1, email: 'a@b' }, labels: ['x', 2] },
      { user: { id: 0, email: 'a@b' }, labels: [] },
      { user: null, labels: [] },
      { user: { id: 1, email: 'a@b', extra: 1 }, labels: [] },
    ],
  },
  {
    type: 'Odd',
    values: [
      { 'not-an-ident': 1, ok: true },
      { 'not-an-ident': 'x', ok: true },
      { 'not-an-ident': 1 },
      { 'not-an-ident': 1, ok: true, more: 0 },
    ],
  },
  {
    type: 'Shape',
    values: [
      { kind: 'circle', r: 1 },
      { kind: 'circle', r: 0 },
      { kind: 'circle', r: -1 },
      { kind: 'circle', r: 'x' },
      { kind: 'square', side: 2 },
      { kind: 'square', r: 2 },
      { kind: 'triangle', side: 2 },
      { kind: 'circle', r: 1, extra: 1 },
      { r: 1 },
    ],
  },
  {
    type: 'Loose',
    values: [{ a: 1 }, { b: 'x' }, { a: 1, b: 'x' }, { a: 'x' }, { b: 1 }, { a: 1, c: 2 }, { c: 3 }],
  },
  { type: 'Colour', values: ['red', 'green', 'blue', 'Red', 'purple', 0] },
  { type: 'Mixed', values: ['x', 0, null, undefined, true, {}] },
  {
    type: 'Pair',
    values: [[1, 'a'], [1, 'a', 2], [1], ['a', 1], [Number.NaN, 'a'], { 0: 1, 1: 'a', length: 2 }],
  },
  {
    type: 'Maybe',
    values: [null, { id: 1, email: 'a@b' }, { id: 0, email: 'a@b' }, { id: 1, email: 'a@b', extra: 1 }, undefined],
  },
  { type: 'number & Min<1> & Max<3>', values: [1, 2, 3, 0, 4, 2.5, Number.NaN, '2'] },
  { type: 'string & MinLength<1>', values: ['', 'a', 'ab', 0, null] },
  { type: 'boolean', values: [true, false, 0, 1, 'true'] },
  { type: 'User[]', values: [[], [{ id: 1, email: 'a@b' }], [{ id: 0, email: 'a@b' }], [{}], {}] },
  { type: 'Colour[]', values: [[], ['red'], ['red', 'green'], ['pink'], ['red', 0]] },
  {
    type: '{ a?: number; b?: string }',
    values: [{}, { a: 1 }, { b: 'x' }, { a: 1, b: 'x' }, { a: 1, c: 2 }, { a: 'x' }],
  },
];

/** The three emitted entry points, plus the IR both sides share. */
interface Compiled {
  readonly ir: TypeIR;
  readonly is: (value: unknown) => boolean;
  readonly equals: (value: unknown) => boolean;
  readonly issues: (value: unknown) => readonly ValidationIssue[];
  readonly code: string;
}

// Opened at module scope rather than in `beforeAll`, because `describe.each` builds its
// cases during collection and every case needs the checker to do it. One session, one
// `tsgo` process, for the whole file.
const project = FixtureProject.open({ declarations: DECLARATIONS });
afterAll(() => project.close());

function compile(type: string): Compiled {
  const ir = project.ir(type);
  const predicate = project.build(`const check = (input) => is<${type}>(input);`);
  const strict = project.build(`const check = (input) => equals<${type}>(input);`);
  const report = project.build(`const check = (input) => validate<${type}>(input);`);
  return {
    ir,
    is: value => predicate.check(value) as boolean,
    equals: value => strict.check(value) as boolean,
    issues: value => {
      const result = report.check(value) as { success: boolean; errors?: readonly ValidationIssue[] };
      return result.success ? [] : (result.errors ?? []);
    },
    code: `${predicate.code}\n${strict.code}\n${report.code}`,
  };
}

/** A label that survives being printed in a failure message. */
function label(value: unknown): string {
  if (typeof value === 'function') return 'function';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (value instanceof Date) return 'Date(0)';
  return JSON.stringify(value) ?? String(value);
}

describe.each(CASES)('$type', ({ type, values }) => {
  const compiled = compile(type);
  const corpus = [...values, ...WILD];

  it('accepts and rejects exactly what the runtime walker does', () => {
    for (const value of corpus) {
      expect(compiled.is(value), `is<${type}>(${label(value)})`).toBe(is(value, compiled.ir));
    }
  });

  it('agrees about excess properties', () => {
    for (const value of corpus) {
      expect(compiled.equals(value), `equals<${type}>(${label(value)})`).toBe(equals(value, compiled.ir));
    }
  });

  it('reports the same issues, at the same paths, in the same order', () => {
    for (const value of corpus) {
      expect(compiled.issues(value), `validate<${type}>(${label(value)})`).toEqual(
        issuesFor(value, compiled.ir).map(issue => ({ ...issue })),
      );
    }
  });

  it('agrees that a rejected value has at least one issue, and an accepted one none', () => {
    // The two are separate code paths in both implementations — `validate` does not call
    // `is` — so "rejects it" and "has something to say about it" can drift apart.
    for (const value of corpus) {
      expect(compiled.issues(value).length === 0, `${type} / ${label(value)}`).toBe(compiled.is(value));
    }
  });
});
