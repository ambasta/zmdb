// What the emitter actually writes.
//
// The differential suite next door proves the emitted code is *correct*; this one pins
// down its *shape*, because the shape is the reason it exists. A validator that agrees
// with the runtime walker on every input but allocates a closure per call has lost the
// argument. So the assertions here are about the generated text: the fast path is a flat
// boolean expression, arrays are a `for` loop rather than `.every`, a named type is one
// hoisted function shared by every call site that mentions it, and the failure path is not
// paid for until it is taken (REQ-AV-7).

import { equals, is, validate } from '@zmdb/aot-validator/utilities';
import type { TypeIR } from '@zmdb/schema-core/ir';
import { afterAll, describe, expect, it } from 'vitest';

import { evaluate, FixtureProject } from './__testing__/project.js';
import { Emitter } from './index.js';

const DECLARATIONS = `  interface User { id: number & Min<1>; email: string & Pattern<"^[^@]+@[^@]+$">; nickname?: string }
  interface Point { x: number; y: number }
  interface Tree { value: number; children: Tree[] }
  interface RecursiveNode { value: number; next: RecursiveNode | null }
  type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
  type Colour = "red" | "green" | "blue";
  type Many = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i";

  function isShallow<T, D extends number = 1>(value: unknown): value is T;
  function assertShallow<T, D extends number = 1>(value: unknown): T;
  function validateShallow<T, D extends number = 1>(
    value: unknown,
  ): { success: boolean; data?: T; errors?: unknown[] };`;

const project = FixtureProject.open({ declarations: DECLARATIONS });
afterAll(() => project.close());

const build = (source: string) => project.build(source);

describe('the fast path', () => {
  it('inlines an anonymous type as one expression, with no helper and no closure', () => {
    const { code } = build('const check = (input) => is<{ n: number }>(input);');
    expect(code).toBe(
      'const check = (input) => (typeof input === "object" && input !== null && !Array.isArray(input) && ' +
        '(typeof input.n === "number" && !Number.isNaN(input.n)));',
    );
    expect(code).not.toContain('function');
    expect(code).not.toContain('=>  {');
  });

  it('rejects an array where an object is expected', () => {
    // `typeof [] === "object"`, so the guard has to say so explicitly. The emitted check
    // used to omit this and accept `[]` as a `{}`.
    const { check } = build('const check = (input) => is<Point>(input);');
    expect(check([])).toBe(false);
    expect(check({ x: 1, y: 2 })).toBe(true);
  });

  it('rejects NaN where a number is expected', () => {
    const { code, check } = build('const check = (input) => is<{ n: number }>(input);');
    expect(code).toContain('!Number.isNaN(input.n)');
    expect(check({ n: Number.NaN })).toBe(false);
  });

  it('walks an array with a counted for loop, not a callback', () => {
    const { code } = build('const check = (input) => is<Point[]>(input);');
    expect(code).toContain('for (let _i = 0; _i < _v.length; _i++)');
    expect(code).not.toContain('.every(');
    expect(code).not.toContain('.some(');
  });

  it('reads a nested property directly rather than binding it', () => {
    const { code } = build('const check = (input) => is<{ a: { b: number } }>(input);');
    expect(code).toContain('input.a.b');
  });
});

describe('shallow validation', () => {
  it('emits no branch for a nested object beyond the depth limit', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], and the source still
    // contains both `isShallow` and the nested property name `hidden`.
    const result = project.transform('const check = (input) => isShallow<{ outer: { hidden: number } }, 1>(input);');
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.code).toContain('typeof input.outer === "object"');
    expect(result.code).not.toContain('hidden');
    expect(result.code).not.toContain('isShallow');
  });

  it('emits two levels of checks at depth 2', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], and `three` remains
    // only because the whole untransformed type argument remains in the source.
    const result = project.transform(
      'const check = (input) => isShallow<{ one: { two: { three: number } } }, 2>(input);',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.code).toContain('input.one.two');
    expect(result.code).not.toContain('three');
    expect(result.code).not.toContain('isShallow');
  });

  it('checks a discriminant even at depth 1', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], so neither tag
    // comparison exists and both nested property names remain in the type text.
    const result = project.transform(
      'const check = (input) => isShallow<' +
        '{ kind: "a"; payload: { secret: number } } | ' +
        '{ kind: "b"; payload: { label: string } }, 1>(input);',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.code).toContain('input.kind === "a"');
    expect(result.code).toContain('input.kind === "b"');
    expect(result.code).not.toContain('secret');
    expect(result.code).not.toContain('label');
  });

  it('checks array-ness at depth 1 and elements per the spec decision', () => {
    // Measured at d34bfbaf: both transforms report changed=false with no
    // diagnostics, leaving the two `isShallow` calls byte-for-byte unchanged.
    const depthOne = project.transform('const check = (input) => isShallow<string[], 1>(input);');
    const depthTwo = project.transform('const check = (input) => isShallow<string[], 2>(input);');
    expect(depthOne.diagnostics).toEqual([]);
    expect(depthTwo.diagnostics).toEqual([]);
    expect(depthOne.changed).toBe(true);
    expect(depthTwo.changed).toBe(true);

    expect(depthOne.code).toContain('Array.isArray');
    expect(depthOne.code).not.toContain('for (let');
    expect(depthOne.code).not.toContain('=== "string"');
    expect(depthTwo.code).toContain('for (let');
    expect(depthTwo.code).toContain('=== "string"');
  });

  it('terminates on a recursive type at the depth limit', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], so the recursive
    // call is never emitted and the TypeScript source cannot be evaluated.
    const result = project.transform('const check = (input) => isShallow<RecursiveNode, 2>(input);');
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);

    const helper = /function (_zmdbCheckRecursiveNode\d+)\(/.exec(result.code)?.[1];
    expect(helper).toBeDefined();
    expect(result.code.match(new RegExp(`${helper as string}\\(`, 'g'))).toHaveLength(2);
    expect(result.code).not.toMatch(/\bdepth\b/i);

    let value: unknown = { value: 'malformed below the limit', next: null };
    for (let index = 0; index < 10_000; index += 1) value = { value: index, next: value };
    expect(evaluate(result.code)(value)).toBe(true);
  });

  it('reports a build diagnostic when depth is not a literal', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], and the non-literal
    // `number` depth is left in the source without an explanation.
    const source = 'const check = (input) => isShallow<{ n: number }, number>(input);';
    const result = project.transform(source);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        callee: 'isShallow',
        reason: expect.stringMatching(/depth.*literal|literal.*depth/i),
      }),
    ]);
  });

  it.each(['0', '-1', '1.5'])('reports a build diagnostic when depth %s is not a positive integer', depth => {
    const source = `const check = (input) => isShallow<{ n: number }, ${depth}>(input);`;
    const result = project.transform(source);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        callee: 'isShallow',
        reason: expect.stringMatching(/depth.*positive integer|positive integer.*depth/i),
      }),
    ]);
  });

  it('uses depth 1 when the second type argument is absent', () => {
    const result = project.transform('const check = (input) => isShallow<{ outer: { hidden: number } }>(input);');
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('typeof input.outer === "object"');
    expect(result.code).not.toContain('hidden');
  });

  it('reuses the full-depth helper when the cap exceeds finite nesting', () => {
    const result = project.transform(
      'const full = (input) => is<User>(input);\nconst check = (input) => isShallow<User, 10>(input);',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/function _zmdbCheckUser\d/g)).toHaveLength(1);
  });

  it('threads the same depth through assertShallow and validateShallow without a runtime counter', () => {
    const asserted = project.transform(
      'const check = (input) => assertShallow<{ outer: { hidden: number } }, 1>(input);',
    );
    const validated = project.transform(
      'const check = (input) => validateShallow<{ outer: { hidden: number } }, 1>(input);',
    );

    for (const result of [asserted, validated]) {
      expect(result.diagnostics).toEqual([]);
      expect(result.changed).toBe(true);
      expect(result.code).not.toContain('hidden');
      expect(result.code).not.toMatch(/\bdepth\b/i);
    }
  });

  it('leaves is() and assert() emitting exactly what they emit today', () => {
    const isCode = build('const check = (input) => is<{ n: number }>(input);').code;
    const assertCode = build('const check = (input) => assert<{ n: number }>(input);').code;

    expect(isCode).toBe(
      'const check = (input) => (typeof input === "object" && input !== null && !Array.isArray(input) && ' +
        '(typeof input.n === "number" && !Number.isNaN(input.n)));',
    );
    expect(assertCode).toBe(
      'import { AssertError as _zmdbAssertError } from "@zmdb/aot-validator/errors";\n' +
        'function _zmdbIssues0(_v, _p, _o) { if (!(typeof _v === "object" && _v !== null && ' +
        '!Array.isArray(_v))) { _zmdbIssue(_o, _p, "object", _v); } else { if (!(typeof _v.n === ' +
        '"number" && !Number.isNaN(_v.n))) _zmdbIssue(_o, _p + ".n", "number", _v.n); } }\n' +
        'function _zmdbIssue(out, path, expected, value) { out.push({ path, expected, value, message: ' +
        '"expected " + expected }); }\n' +
        'const check = (input) => ((() => { if ((typeof input === "object" && input !== null && ' +
        '!Array.isArray(input) && (typeof input.n === "number" && !Number.isNaN(input.n)))) return input; ' +
        'const _e = []; _zmdbIssues0(input, "input", _e); throw new _zmdbAssertError(_e[0] ? ' +
        '_e[0].message : "validation failed", _e); })());',
    );
  });
});

describe('hoisting', () => {
  it('hoists a named type into one function and calls it', () => {
    const { code } = build('const check = (input) => is<User>(input);');
    expect(code).toContain('function _zmdbCheckUser0(_v) {');
    expect(code.trimEnd().endsWith('const check = (input) => (_zmdbCheckUser0(input));')).toBe(true);
  });

  it('shares one helper between two call sites naming the same type', () => {
    const { code } = build('const a = (input) => is<User>(input);\nconst check = (input) => is<User>(input);\n');
    expect(code.match(/function _zmdbCheckUser\d/g)).toHaveLength(1);
  });

  it('closes a recursive type by calling its own helper', () => {
    const { code, check } = build('const check = (input) => is<Tree>(input);');
    const name = /function (_zmdbCheckTree\d+)/.exec(code)?.[1];
    expect(name).toBeDefined();
    // The recursive reference is the helper itself; nothing else terminates the walk.
    expect(code.indexOf(`${name as string}(`, code.indexOf(`function ${name as string}`) + 1)).toBeGreaterThan(0);
    expect(check({ value: 1, children: [{ value: 2, children: [] }] })).toBe(true);
    expect(check({ value: 1, children: [{ value: 'x', children: [] }] })).toBe(false);
  });

  it('names the helper after the type, so generated code is readable', () => {
    const { code } = build('const check = (input) => is<Point>(input);');
    expect(code).toContain('_zmdbCheckPoint');
  });

  it('honours a caller-supplied prefix', () => {
    using scoped = FixtureProject.open({
      declarations: '  interface Point { x: number; y: number }',
      emit: { prefix: '$v' },
    });
    const { code } = scoped.build('const check = (input) => is<Point>(input);');
    expect(code).toContain('$vCheckPoint');
    expect(code).not.toContain('_zmdb');
  });
});

describe('unions', () => {
  it('switches a discriminated union on its tag instead of trying every arm', () => {
    const { code, check } = build('const check = (input) => is<Shape>(input);');
    expect(code).toContain('input.kind === "circle" ?');
    expect(code).toContain('input.kind === "square" ?');
    // One record test for the union, not one per arm.
    expect(code.match(/!Array\.isArray\(input\)/g)).toHaveLength(1);
    expect(check({ kind: 'circle', r: 1 })).toBe(true);
    expect(check({ kind: 'square', side: 1 })).toBe(true);
    expect(check({ kind: 'triangle', side: 1 })).toBe(false);
  });

  it('spells a small literal union as a comparison chain', () => {
    const { code, check } = build('const check = (input) => is<Colour>(input);');
    expect(code).toContain('input === "red"');
    expect(code).not.toContain('new Set');
    expect(check('red')).toBe(true);
    expect(check('pink')).toBe(false);
  });

  it('switches to a hoisted Set once a literal union gets wide', () => {
    // Nine string comparisons in a row is where a hash lookup starts winning; the
    // threshold is a guess, but a linear scan that keeps growing is not.
    const { code, check } = build('const check = (input) => is<Many>(input);');
    expect(code).toContain('new Set([');
    expect(code).toContain('.has(input)');
    expect(check('i')).toBe(true);
    expect(check('j')).toBe(false);
  });

  it('falls back to an OR of members when there is no discriminant', () => {
    const { code, check } = build('const check = (input) => is<{ a: number } | { b: string }>(input);');
    expect(code).toContain(' || ');
    expect(code).not.toContain(' ? ');
    expect(check({ a: 1 })).toBe(true);
    expect(check({ b: 'x' })).toBe(true);
    expect(check({ c: 1 })).toBe(false);
  });
});

describe('excess properties', () => {
  it('counts keys when every property is required', () => {
    // `equals` runs after `is` has passed, so every declared property is known to be
    // there: "no excess" reduces to "the counts agree", with no Set to allocate.
    const { code, check } = build('const check = (input) => equals<Point>(input);');
    expect(code).toContain('!== 2) return false;');
    expect(code).not.toContain('new Set');
    expect(check({ x: 1, y: 2 })).toBe(true);
    expect(check({ x: 1, y: 2, z: 3 })).toBe(false);
  });

  it('uses a hoisted key Set when a property is optional', () => {
    const { code, check } = build('const check = (input) => equals<User>(input);');
    expect(code).toContain('new Set(["id", "email", "nickname"]);');
    expect(check({ id: 1, email: 'a@b' })).toBe(true);
    expect(check({ id: 1, email: 'a@b', nickname: 'x' })).toBe(true);
    expect(check({ id: 1, email: 'a@b', extra: 1 })).toBe(false);
  });

  it('stays a single expression rather than an inline block', () => {
    const { code } = build('const check = (input) => equals<Point>(input);');
    // Two calls joined by `&&`, and no wrapper function around either: `equals<T>(x)` in
    // an `if` should not have to pay for an IIFE to run its second pass.
    expect(code).toContain('const check = (input) => ((_zmdbCheckPoint0(input)) && _zmdbExcessPoint1(input));');
    expect(code).not.toContain('(() => {');
  });

  it('skips the walk entirely for a type with nowhere to put an excess key', () => {
    const { code } = build('const check = (input) => equals<number[]>(input);');
    expect(code).not.toContain('Excess');
  });
});

describe('the failure path', () => {
  it('does not build anything before deciding the value is fine', () => {
    const { code } = build('const check = (input) => assert<User>(input);');
    const body = code.slice(code.indexOf('const check ='));
    const early = body.indexOf('return input;');
    expect(early).toBeGreaterThan(0);
    // REQ-AV-7: no issue array, no issue object, no error, ahead of the early return.
    const before = body.slice(0, early);
    expect(before).not.toContain('[]');
    expect(before).not.toContain('Issue');
    expect(before).not.toContain('new ');
  });

  it('throws the real AssertError, imported rather than redeclared', () => {
    const { code, check } = build('const check = (input) => assert<User>(input);');
    expect(code).toContain('import { AssertError as _zmdbAssertError } from "@zmdb/aot-validator/errors";');
    expect(check({ id: 1, email: 'a@b' })).toEqual({ id: 1, email: 'a@b' });
    expect(() => check({ id: 1, email: 7 })).toThrow(/expected string/);
  });

  it('reports the failing path, not just that something failed', () => {
    const { check } = build('const check = (input) => validate<User>(input);');
    expect(check({ id: 1, email: 'a@b' })).toEqual({ success: true, data: { id: 1, email: 'a@b' } });
    expect(check({ id: 0, email: 'a@b' })).toEqual({
      success: false,
      errors: [{ path: 'input.id', expected: 'minimum 1', value: 0, message: 'expected minimum 1' }],
    });
  });

  it('blames the tag when a discriminated union does not match any arm', () => {
    const { check } = build('const check = (input) => validate<Shape>(input);');
    expect(check({ kind: 'triangle', side: 1 })).toEqual({
      success: false,
      errors: [
        {
          path: 'input.kind',
          expected: '"circle" | "square"',
          value: 'triangle',
          message: 'expected "circle" | "square"',
        },
      ],
    });
  });

  it('mentions excess properties only when nothing else was wrong', () => {
    const { check } = build('const check = (input) => assertEquals<User>(input);');
    expect(() => check({ id: 1, email: 'a@b', extra: 1 })).toThrow(/no excess properties/);
    // `email` is the real problem here; "you also passed `extra`" would be noise.
    expect(() => check({ id: 1, email: 7, extra: 1 })).toThrow(/expected string/);
  });
});

describe('argument evaluation', () => {
  it('re-reads a plain reference rather than wrapping it', () => {
    const { code } = build('const check = (input) => is<Point>(input);');
    expect(code).not.toContain('_zmdbArg');
  });

  it('evaluates a call argument exactly once', () => {
    const { code, check } = build('const check = (input) => is<Point>(input());');
    expect(code).toContain('_zmdbArg0');
    let calls = 0;
    const source = () => {
      calls += 1;
      return { x: 1, y: 2 };
    };
    expect(check(source)).toBe(true);
    expect(calls).toBe(1);
  });

  it('rewrites an inner call before the outer one that contains it', () => {
    const { code, check } = build('const check = (input) => assert<Point>(is<{ n: number }>(input) ? input : input);');
    expect(code).not.toContain('is<');
    expect(code).toContain('_zmdbArg');
    expect(check({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

describe('refusals', () => {
  it('refuses an index signature by name instead of pretending to check it', () => {
    const result = project.transform('const check = (input) => is<Record<string, number>>(input);');
    expect(result.changed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.reason).toContain('index signature');
    expect(result.diagnostics[0]?.callee).toBe('is');
    expect(result.diagnostics[0]?.position).toBeGreaterThan(0);
  });

  it('leaves no dead prelude behind when every site is refused', () => {
    const result = project.transform('const check = () => random<User>();');
    expect(result.changed).toBe(false);
    expect(result.code).not.toContain('_zmdb');
  });

  it('refuses rather than guessing when the file does not compile', () => {
    const result = project.transform('const check = (input) => is<NotAType>(input);');
    expect(result.changed).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('stops at the maximum helper count instead of emitting a truncated check', () => {
    using scoped = FixtureProject.open({
      declarations: '  interface Point { x: number; y: number }',
      emit: { maxHelpers: 0 },
    });
    const result = scoped.transform('const check = (input) => is<Point>(input);');
    expect(result.changed).toBe(false);
    expect(result.diagnostics[0]?.reason).toMatch(/helper/);
  });
});

describe('sampling', () => {
  it('builds a value its own check accepts', () => {
    const { check } = build('const check = () => random<Point>();');
    const sample = check(undefined) as unknown;
    expect(is(sample, project.ir('Point'))).toBe(true);
  });

  it('respects bounds', () => {
    const { check } = build('const check = () => random<{ n: number & Min<5> & Max<7> }>();');
    for (let index = 0; index < 50; index += 1) {
      const sample = check(undefined) as { n: number };
      expect(sample.n).toBeGreaterThanOrEqual(5);
      expect(sample.n).toBeLessThanOrEqual(7);
    }
  });

  it('refuses a pattern, because nothing here inverts a regular expression', () => {
    const result = project.transform('const check = () => random<User>();');
    expect(result.changed).toBe(false);
    expect(result.diagnostics[0]?.reason).toContain('pattern');
  });
});

describe('the runtime walker agrees about the same shapes', () => {
  // A spot check that `utilities` is a validator in its own right, since the differential
  // suite only ever compares it against the emitted form.
  it('validates without a compiler', () => {
    const ir = project.ir('User');
    expect(is({ id: 1, email: 'a@b' }, ir)).toBe(true);
    expect(is({ id: 0, email: 'a@b' }, ir)).toBe(false);
    expect(equals({ id: 1, email: 'a@b', extra: 1 }, ir)).toBe(false);
    expect(validate({ id: 1, email: 'a@b' }, ir)).toEqual({ success: true, data: { id: 1, email: 'a@b' } });
  });
});

describe('the Emitter, driven directly', () => {
  // Everything above goes through a `FixtureProject`, which is a compiler, a reflection and an
  // emitter in one call — the right shape for asserting what a build produces, and the wrong
  // one for asserting whose fault it is when the answer is wrong. The emitter is a pure
  // function of IR, so it can be asked on its own, and this is the half project compilation drives:
  // it has its own IR from somewhere else and wants source text back.
  const USER: TypeIR = {
    kind: 'object',
    name: 'User',
    properties: [
      {
        name: 'id',
        type: { kind: 'scalar', scalar: 'integer', constraints: { minimum: 1 } },
        optional: false,
        readonly: false,
      },
      { name: 'email', type: { kind: 'scalar', scalar: 'string' }, optional: false, readonly: false },
    ],
  };
  const POINT: TypeIR = {
    kind: 'object',
    properties: [
      { name: 'x', type: { kind: 'scalar', scalar: 'number' }, optional: false, readonly: false },
      { name: 'y', type: { kind: 'scalar', scalar: 'number' }, optional: false, readonly: false },
    ],
  };

  /** Compile what the emitter wrote and run it, which is what a bundler would end up doing. */
  const run = (emitter: Emitter, code: string, value: unknown): unknown =>
    new Function('input', `${emitter.prelude()}\nreturn ${code};`)(value);

  it('turns IR into an expression that answers the same as the runtime walk', () => {
    // REQ-AV-4 in its smallest form. The differential suite next door runs this over a corpus
    // through a real build; here it is the emitter alone, so a disagreement points at one file.
    const emitter = new Emitter();
    const code = emitter.emitIs(USER, 'input');
    expect(code).toBeDefined();
    for (const value of [
      { id: 1, email: 'a@b.com' },
      { id: 0, email: 'a@b.com' },
      { id: 1, email: 7 },
      { id: 1 },
      null,
      [],
      'nope',
    ]) {
      expect(run(emitter, code as string, value)).toBe(is(value, USER));
    }
    expect(emitter.diagnostics).toEqual([]);
  });

  it('needs no prelude for an anonymous type, and one for a named type', () => {
    // `hasPrelude` is what a caller checks before deciding whether to touch the top of the
    // file at all. Answering `true` when nothing was hoisted would mean every transformed
    // module grew an edit — and a sourcemap change — for no reason.
    const anonymous = new Emitter();
    expect(anonymous.emitIs(POINT, 'input')).toBeDefined();
    expect(anonymous.hasPrelude).toBe(false);
    expect(anonymous.prelude()).toBe('');

    const named = new Emitter();
    expect(named.emitIs(USER, 'input')).toBeDefined();
    expect(named.hasPrelude).toBe(true);
    expect(named.prelude()).toContain('User');
  });

  it('shares one helper between two call sites naming the same type', () => {
    // Per emitter, not per call: the emitter is the file, and two `is<User>(…)` in one module
    // that each hoisted their own function would double the code for no behaviour.
    const emitter = new Emitter();
    const first = emitter.emitIs(USER, 'a');
    const second = emitter.emitIs(USER, 'b');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(emitter.prelude().match(/function /g) ?? []).toHaveLength(1);
  });

  it('imports AssertError from where it is told, under the prefix it is given', () => {
    // Both options exist for the same consumer: project compilation writes a file that has to
    // import from the package by name, and the prefix keeps the emitted identifiers from
    // colliding with whatever the module already declares.
    const emitter = new Emitter({ prefix: '_gen', errorModule: './my-errors.js' });
    expect(emitter.emitAssert(USER, 'input', false)).toBeDefined();
    const prelude = emitter.prelude();
    expect(prelude).toContain('import { AssertError as _genAssertError } from "./my-errors.js";');
    expect(prelude).not.toContain('_zmdb');
  });

  it('refuses rather than emitting a check for a type it does not understand', () => {
    // The `f70186c6` rule, at the emitter's level: no partial answer. A refusal is `undefined`
    // *and* a diagnostic, because a caller that only looked at the return value would leave
    // the call site alone and never say why.
    const emitter = new Emitter();
    const node: TypeIR = {
      kind: 'object',
      properties: [
        { name: 'bag', type: { kind: 'unsupported', reason: 'index signature' }, optional: false, readonly: false },
      ],
    };
    expect(emitter.emitIs(node, 'input')).toBeUndefined();
    expect(emitter.diagnostics.map(d => d.reason)).toEqual(['index signature']);
    // `path` is deliberately not asserted. `EmitDiagnostic` documents it as "the property
    // chain that reached it, as in the reflection", and it is not one: the `path` threaded
    // through the walk is a JavaScript *expression*, because for `assert`/`validate` it
    // becomes the `path` of a runtime issue, and `#refuse` reports that expression verbatim.
    // For this refusal it reads ` + ".bag"`. Nothing surfaces it today — the reflector refuses
    // an index signature first, so `transformFile` never reaches the emitter's copy — but the
    // emitter-only refusals (an empty union, a `pattern` on a non-string, a dangling `ref`, the
    // helper cap) do reach a build log through the same field. Writing the current answer down
    // here would make it the contract, and it is a defect rather than a decision.
  });

  it('refuses at the helper cap instead of emitting a truncated check', () => {
    const emitter = new Emitter({ maxHelpers: 0 });
    expect(emitter.emitIs(USER, 'input')).toBeUndefined();
    expect(emitter.diagnostics.length).toBeGreaterThan(0);
  });
});
